# Open the beta to anyone with the link

This is a one-time switch for when the owner is ready. It has **not** been applied
to the hosted service by adding this guide. It allows any verified Google user
with the website link to join; the link is not a secret invitation code.

Flowlist already supports open signup. No new authentication provider, database
migration, per-email provisioning, or invitation email is needed. Accounts and
all saved work remain isolated by authenticated user ID.

## One-time setup

1. **Google Auth Platform → Audience:** use an External audience. Publish the
   OAuth app when ready for general access and follow the console's branding
   requirements. Keep only `openid`, `email`, and `profile` scopes. Flowlist
   already requests only those scopes; it does not need Gmail or Calendar access.
   Google's current documentation explicitly exempts these basic identity
   scopes from the Testing test-user allowlist, so per-email Google additions
   are not required for this configuration. Publishing is still appropriate
   when leaving the private test phase; it is separate from brand verification.
2. **Supabase → Authentication → Sign In / Providers:** enable **Allow new users
   to sign up**. Keep Google enabled. Keep anonymous sign-in disabled. If the
   beta is Google-only, disable the Email provider as well; hiding Flowlist's
   email form alone does not disable direct email authentication at Supabase.
   Keep email ownership verification enabled if email sign-in is offered later.
3. **Render → flowlist-beta → Environment:** set `FLOWLIST_BETA_SIGNUPS=open`.
   Keep `FLOWLIST_GOOGLE_LOGIN=true` and `FLOWLIST_EMAIL_LOGIN=false`.
   `FLOWLIST_BETA_EMAILS` is ignored in open mode; retain it for a possible
   return to a private beta. Save and redeploy.
4. Update `render.yaml`'s `FLOWLIST_BETA_SIGNUPS` value to `open` when making this
   change, so a future Blueprint sync does not restore `invite`.
5. Test with a Google account that has never been added to Supabase or the
   allowlist. Sign in, verify the empty private workspace, dismiss or finish
   the guide, save a task, reload, and check the task remains. In a separate
   account, verify that the other account's work is not visible.

After that, share https://flowlist-beta.onrender.com/ directly. First sign-in
creates the account. Users can delete their account from Account and export
saved data from History.

If access should remain private while avoiding per-email administration, a
redeemable invitation-link system is a different feature. Do not use a shared
password or a client-side-only invite code. For a small open beta, the existing
Google signup flow is the simpler choice.

## Closing signup again

Turn off Supabase's **Allow new users to sign up** to stop new accounts while
letting existing beta users continue. Leave Flowlist in `open` mode for that
behavior. Switching Flowlist back to `invite` also denies access to existing
users absent from `FLOWLIST_BETA_EMAILS`. Update the Blueprint to match any
intentional mode change.

## Guide behavior

The first authenticated visit opens an seven-step guide covering Plan,
priorities, the timer, settings, session notes, completion, and History. New
users finish it once; closing or reloading the page resumes their current step.
It can be replayed from Guide in the toolbar and closed during replay. Existing
users who acknowledged the previous guide are not forced through it again.
A marked Learn Flowlist example project is created once per account and reused
on replay. Its real Plan star updates Priority tasks; notes and finish controls
remain isolated practice examples and never start a timer or save sessions.
The final step offers Keep example or Remove example. Removal is restricted to
the marked project, removes its queue entries, and preserves saved history. Active or unsaved rituals take
precedence over automatically showing the guide.

Older beta APIs without the Guide example endpoint use an isolated practice star
and the same seven-step walkthrough, without creating projects or modifying Plan.
Other example-loading failures offer Retry and Use Flowlist. Leaving a failed
guide defers automatic prompting for that page session without marking it complete;
Guide in the toolbar can retry it at any time.

For new users, finishing stores version 3 in the authenticated user's Supabase
`user_metadata.flowlist_onboarding_version`. That is a display preference only,
never an authorization field. Migration 20260927_15 adds a unique example key
to goals; run migrations before starting the updated API. A per-account
local hint also prevents repeated prompts if preference syncing is unavailable;
a visible message explains a failed sync. Local development offers the guide
from Guide without showing it automatically on every fresh browser. Partial
progress is stored per account in the current browser, separately from completion.

## References

- [Google OAuth app states and basic identity scope exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Supabase signup configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase user metadata updates](https://supabase.com/docs/reference/javascript/auth-updateuser)
