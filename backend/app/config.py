"""Fail-closed beta configuration; local mode is explicitly development-only."""
import os
from urllib.parse import urlparse


def auth_mode():
    mode = os.getenv('FLOWLIST_AUTH_MODE', 'supabase')
    if mode not in ('local', 'supabase'):
        raise RuntimeError('FLOWLIST_AUTH_MODE must be local or supabase')
    if mode == 'local' and os.getenv('FLOWLIST_ENV') == 'production':
        raise RuntimeError('Production cannot use local authentication mode')
    return mode


def supabase_url():
    value = os.getenv('SUPABASE_URL', '').rstrip('/')
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.query or parsed.fragment or parsed.path:
        raise RuntimeError('Set SUPABASE_URL to the HTTPS project origin')
    return value


def public_config():
    if auth_mode() == 'local':
        return {'auth_mode': 'local'}
    key = os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
    # Only the new publishable key format: never accidentally expose a service JWT.
    if not key.startswith('sb_publishable_'):
        raise RuntimeError('Set SUPABASE_PUBLISHABLE_KEY to an sb_publishable_ key')
    return {'auth_mode': 'supabase', 'supabase_url': supabase_url(), 'supabase_key': key,
            'google_enabled': os.getenv('FLOWLIST_GOOGLE_LOGIN', 'false') == 'true',
            'signup_enabled': os.getenv('FLOWLIST_BETA_SIGNUPS', 'invite') == 'open'}
