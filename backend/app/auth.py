"""Supabase verifies the access token online and returns its current user.

Do not decode unsigned client claims or cache successful identity checks.
"""
import os
import atexit
from dataclasses import dataclass
from uuid import UUID
import httpx
from fastapi import Header, HTTPException
from app.config import auth_mode, public_config, supabase_url


# Reuse TLS connections, but verify every request against Supabase as before.
verification_client = httpx.Client(timeout=8, follow_redirects=False)
atexit.register(verification_client.close)

@dataclass(frozen=True)
class Identity:
    id: str | None
    email: str = ''
    onboarding_version: int = 0


def verify_access_token(token: str) -> dict:
    config = public_config()
    try:
        response = verification_client.get(f'{supabase_url()}/auth/v1/user', headers={
            'apikey': config['supabase_key'], 'Authorization': f'Bearer {token}',
        }, timeout=8, follow_redirects=False)
    except httpx.HTTPError:
        raise HTTPException(503, 'Sign-in verification is temporarily unavailable. Please retry.')
    if response.status_code in (401, 403):
        raise HTTPException(401, 'Your sign-in has expired. Please sign in again.')
    if response.status_code != 200:
        raise HTTPException(503, 'Sign-in verification is temporarily unavailable. Please retry.')
    try:
        value = response.json()
        if not isinstance(value, dict): raise ValueError()
        return value
    except ValueError:
        raise HTTPException(503, 'Sign-in verification is temporarily unavailable.')


def get_identity(authorization: str | None = Header(None)) -> Identity:
    if auth_mode() == 'local':
        return Identity(None)
    if not authorization or not authorization.startswith('Bearer ') or len(authorization) > 16384:
        raise HTTPException(401, 'Sign in to use Flowlist.', headers={'WWW-Authenticate': 'Bearer'})
    user = verify_access_token(authorization[7:])
    try:
        subject = str(UUID(user['id']))
    except (KeyError, ValueError, TypeError, AttributeError):
        raise HTTPException(401, 'Invalid sign-in identity.')
    if user.get('is_anonymous') or not user.get('email_confirmed_at') or not isinstance(user.get('email'), str):
        raise HTTPException(403, 'Verify your email before using Flowlist.')
    email = user['email'].strip().lower()
    if os.getenv('FLOWLIST_BETA_SIGNUPS', 'invite') != 'open':
        invited = {entry.strip().lower() for entry in os.getenv('FLOWLIST_BETA_EMAILS', '').split(',') if entry.strip()}
        if email not in invited:
            raise HTTPException(403, 'This beta is invitation-only. This email has not been invited yet.')
    metadata = user.get('user_metadata')
    version = metadata.get('flowlist_onboarding_version', 0) if isinstance(metadata, dict) else 0
    # User-editable display preference only; never used to authorize access.
    return Identity(subject, email, version if type(version) is int and version >= 0 else 0)


def remove_auth_user(subject: str):
    key = os.getenv('SUPABASE_SECRET_KEY', '')
    if not key:
        raise HTTPException(503, 'Account deletion is not configured. Contact the beta owner.')
    try:
        response = httpx.delete(f'{supabase_url()}/auth/v1/admin/users/{subject}',
            headers={'apikey':key}, timeout=10, follow_redirects=False)
    except httpx.HTTPError:
        raise HTTPException(503, 'Your app data is deleted. Identity deletion needs a retry; use Delete account again.')
    if response.status_code not in (200, 204, 404):
        raise HTTPException(503, 'Your app data is deleted. Identity deletion needs a retry; use Delete account again.')
