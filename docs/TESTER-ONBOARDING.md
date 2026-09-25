# First Flowlist testers

Start with a small group using Google accounts. Keep public signup disabled.
Do not send invitations until the three access checks below are complete.

## Owner setup

1. Obtain each tester's exact Google email address. Add it to Google Auth
   Platform → Audience → Test users while the OAuth application is in Testing.
2. Provision a passwordless Supabase user for that address through Auth Admin
   `createUser`, with `email_confirm: false`. Reuse an existing matching user;
   do not reset it. Do not set a shared password or administratively verify
   ownership. Google supplies verified identity at their first Google login.
   Supabase's automatic linking attaches that identity to the pre-created
   account. No invitation email or email-code login is required for this flow.
3. Append the tester's address to Render → flowlist-beta → Environment →
   `FLOWLIST_BETA_EMAILS`, preserving the owner and all existing testers.
   Addresses are comma-separated. Keep `FLOWLIST_BETA_SIGNUPS=invite`,
   `FLOWLIST_GOOGLE_LOGIN=true`, and `FLOWLIST_EMAIL_LOGIN=false`.
4. Save and deploy the tested release. Confirm `/api/config` reports Google
   enabled, email disabled, and signup disabled. Have the first tester sign in
   using their approved Google account in Chrome or Safari, then verify they
   get an empty workspace and can save and reload their own task.

Local `.env.beta` values do not propagate to Render automatically. Google test
users, Supabase accounts, and Flowlist's deployed allowlist are separate gates.
No part of this workflow sends a message without the owner's instruction.

The Google provisioning approach follows Supabase's
[automatic linking documentation](https://supabase.com/docs/guides/auth/auth-identity-linking)
and [account-linking implementation](https://github.com/supabase/auth/blob/master/internal/models/linking.go).
Unlike email OTP, the Google provider verifies the email before linking. A
first real tester login is still necessary to validate the hosted flow.

## Message to send after access is ready

> I'd like you to try the private beta of Flowlist:
> https://flowlist-beta.onrender.com/
>
> Open it in Chrome or Safari and choose Continue with Google using the Google
> email you gave me. Your workspace is separate from everyone else's.
>
> Over the next few days, use it for one real project: add a few tasks, complete
> a focus session, save what you accomplished, and check History. Refresh or
> sign out and back in to check that your work stays saved.
>
> Please tell me what felt confusing, whether anything failed to save, and
> whether you would use it again. For a bug, send the steps and your browser;
> a screenshot is helpful if it doesn't contain anything private.
>
> This is an early beta. The first load may be slow after inactivity. Keep the
> tab open for timer reminders; computer sleep can delay them. You can export
> your saved data from History and delete your account from Account.

## Feedback and follow-up

Record issues as: what they tried, expected result, actual result, browser,
and whether work was lost. Prioritize lost data, sign-in problems, and timer
errors before visual refinements. After a few days ask whether they returned
without a reminder and which part was useful. Avoid adding features from one
isolated suggestion before seeing the underlying problem.

To stop someone's beta access, remove their email from Render's allowlist and
redeploy; this does not delete their data. Account deletion remains a separate
explicit action.
