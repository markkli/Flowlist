import { isNative, bootstrapNative, nativeCall, onNativeState } from '../../shared/native';
import { createClient } from '@supabase/supabase-js';
import { configureAccount, lockAccount, accountLocked, clearAccountDrafts, accountKey } from '../../shared/account';
import './auth.css';
import { captureGoogleCallback, startGoogleSignIn, finishGoogleSignIn } from './google';

const el = id => document.getElementById(id);
export async function initAuth() {
  if (isNative()) return initNativeAuth();
  const googleCallback = captureGoogleCallback();
  let config;
  try {
    const response = await fetch('/api/config', {cache:'no-store',signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Sign-in is not configured or the server is unavailable. Please retry shortly.');
    config = await response.json();
    if (!['local','supabase'].includes(config.auth_mode)) throw new Error('The server returned an invalid configuration.');
  } catch(error) {
    el('auth-error').textContent = error.message;
    el('auth-retry').hidden = false;
    el('auth-retry').onclick = () => location.reload();
    el('auth-loading').hidden = true;
    return false;
  }
  if (config.auth_mode === 'local') {
    configureAccount(null,null);
    document.body.classList.add('app-ready');
    el('auth-screen').hidden = true;
    return { onboarding: { automatic: false } };
  }
  const client = createClient(config.supabase_url, config.supabase_key, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'},
  });
  const emailEnabled = config.email_enabled === true;
  const googleEnabled = config.google_enabled === true;
  el('account-delete-beta-note').hidden = config.signup_enabled === true;
  let activeId = null;
  let ready = false;
  let checking = false;
  let email = '';
  let cooldownUntil = 0;
  let signingIn = false;
  let finish;
  const signedIn = new Promise(resolve => {finish=resolve;});
  el('auth-loading').hidden = true;
  el('auth-form').hidden = !emailEnabled;
  el('auth-form').inert = !emailEnabled;
  el('auth-beta-note').textContent = config.signup_enabled
    ? 'A quiet place for your work. Sign in or create your account.'
    : googleEnabled && !emailEnabled
      ? 'Private beta · Continue with your invited Google account.'
      : 'Private beta · Use your invited email address.';
  el('auth-google-option').hidden = !googleEnabled;
  el('auth-divider').hidden = !(googleEnabled && emailEnabled);
  if (!emailEnabled && !googleEnabled) {
    el('auth-error').textContent = 'Sign-in is not available right now. Please contact the person who invited you.';
  }

  function setSigningIn(busy, google = false) {
    signingIn = busy;
    el('auth-form').inert = busy || !emailEnabled;
    el('auth-submit').disabled = busy || !emailEnabled;
    el('auth-google').disabled = busy || !googleEnabled;
    el('auth-google').setAttribute('aria-busy', String(busy && google));
    el('auth-google-label').textContent = busy && google ? 'Connecting to Google…' : 'Continue with Google';
  }
  // Returning with the Back button can restore a page frozen just before redirect.
  window.addEventListener('pageshow', event => {if (event.persisted && !ready) setSigningIn(false);});
  el('auth-google').onclick = async () => {
    if (signingIn || config.google_enabled !== true) return;
    setSigningIn(true, true);
    el('auth-error').textContent = ''; el('auth-status').textContent = '';
    try { await startGoogleSignIn(client, { emailEnabled }); }
    catch(error) {el('auth-error').textContent = error.message; setSigningIn(false);}
  };

  function freeze(message) {
    lockAccount();
    document.body.classList.remove('app-ready','modal-open');
    document.querySelectorAll('.overlay').forEach(node => node.classList.add('hidden'));
    el('timer-mini').classList.add('hidden');
    el('auth-screen').hidden = false;
    el('auth-form').hidden = true;
    el('auth-google-option').hidden = true;
    el('auth-error').textContent = message;
    el('auth-retry').hidden = false;
    el('auth-retry').onclick = () => location.reload();
  }
  client.auth.onAuthStateChange((_event,session) => {
    if (ready && session?.user.id !== activeId) freeze('You signed out or changed accounts in another tab. Reload to continue.');
  });
  async function accept(session) {
    if (!session || checking) return;
    checking=true;
    try {
      const response=await fetch('/api/account',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
      const profile=await response.json();
      if (!response.ok) throw new Error(profile.detail || 'Could not verify your beta access.');
      if(profile.id!==session.user.id) throw new Error('Account verification did not match. Please sign in again.');
      activeId=profile.id;
      configureAccount(activeId,async()=>{
        const {data,error}=await client.auth.getSession();
        if(error || data.session?.user.id!==activeId) {freeze('Your sign-in changed. Reload to continue.');return null;}
        return data.session.access_token;
      });
      el('account-email').textContent=profile.email;
      el('account-controls').hidden=false;
      el('connection-label').textContent='Beta';
      document.body.classList.add('app-ready');
      el('auth-screen').hidden=true;
      ready=true;
      finish({ onboarding: {
        automatic: true,
        version: profile.onboarding_version || 0,
        async save(version) {
          if (accountLocked()) throw new Error('Your account changed.');
          const { data: current, error: sessionError } = await client.auth.getSession();
          if (sessionError || current.session?.user.id !== activeId) throw new Error('Your account changed.');
          const { error } = await client.auth.updateUser({ data: { flowlist_onboarding_version: version } });
          if (error) throw error;
        },
      } });
    } catch(error) {
      el('auth-error').textContent=error.message;
      el('auth-change-email').hidden=!emailEnabled;
      el('auth-retry').hidden=false;
      el('auth-retry').onclick=()=>location.reload();
    } finally {checking=false;}
  }
  el('auth-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if (signingIn || !emailEnabled) return;
    const submit=el('auth-submit');
    setSigningIn(true);el('auth-error').textContent='';
    try {
      if(!email) {
        if(Date.now()<cooldownUntil) throw new Error('Please wait a minute before requesting another code.');
        const entered=el('auth-email').value.trim();
        const {error}=await client.auth.signInWithOtp({email:entered,options:{shouldCreateUser:config.signup_enabled}});
        if(error) throw error;
        email=entered;cooldownUntil=Date.now()+60000;
        el('auth-code-row').hidden=false;el('auth-email').readOnly=true;
        el('auth-status').textContent=`Check ${email} for your sign-in code.`;
        el('auth-code').required=true;
        el('auth-change-email').hidden=false;
        submit.textContent='Verify and continue';
      } else {
        const {data,error}=await client.auth.verifyOtp({email,token:el('auth-code').value.trim(),type:'email'});
        if(error) throw error;
        await accept(data.session);
      }
    } catch(error) {el('auth-error').textContent=error.message || 'Could not sign in. Please try again.';}
    finally {setSigningIn(false);if(email && !ready) el('auth-code').focus();}
  });
  el('auth-change-email').onclick=async()=>{
    await client.auth.signOut({scope:'local'});
    email='';el('auth-code').value='';el('auth-code').required=false;el('auth-code-row').hidden=true;
    el('auth-retry').hidden=true;
    el('auth-email').readOnly=false;el('auth-submit').textContent='Send sign-in code';
    el('auth-status').textContent='';el('auth-error').textContent='';el('auth-email').focus();
  };
  el('account-signout').onclick=async()=>{
    let draft;
    try { draft=JSON.parse(localStorage.getItem(accountKey('flowlist-ritual-v2')) || 'null'); } catch { /* A damaged draft must not prevent sign-out. */ }
    if(draft && draft.phase!=='saved' && !confirm('Sign out? Your unsaved ritual will remain on this browser for this account.')) return;
    lockAccount();
    const {error}=await client.auth.signOut({scope:'local'});
    if(error) {freeze('Sign-out could not finish. Your workspace is locked; reload and try again.');return;}
    location.reload();
  };
  el('account-delete-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(el('account-delete-confirm').value!=='DELETE') return;
    const button=el('account-delete');button.disabled=true;
    el('account-error').textContent='';
    try {
      const {data}=await client.auth.getSession();
      if(data.session?.user.id!==activeId) throw new Error('Please sign in to this account again.');
      const response=await fetch('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({confirmation:'DELETE'}),signal:AbortSignal.timeout(20000)});
      const body=await response.json();
      if(!response.ok) throw new Error(body.detail || 'Could not delete the account.');
      clearAccountDrafts(activeId);
      lockAccount();await client.auth.signOut({scope:'local'});location.reload();
    } catch(error) {el('account-error').textContent=error.message;}
    finally {button.disabled=false;}
  });
  if (googleCallback) {
    setSigningIn(true);
    el('auth-status').textContent = 'Finishing Google sign-in…';
    try { await accept(await finishGoogleSignIn(client, googleCallback, { emailEnabled })); }
    catch(error) {el('auth-error').textContent = error.message;}
    finally {setSigningIn(false); el('auth-status').textContent = '';}
    // Never fall back to a previous user's session after a failed Google return.
    return signedIn;
  }
  const {data,error}=await client.auth.getSession();
  if(error) el('auth-error').textContent=error.message;
  if(data.session) await accept(data.session);
  return signedIn;
}

async function initNativeAuth() {
  const state=await bootstrapNative();
  if(state.needsSignIn && !state.account) await chooseNativeAccount();
  configureAccount(state.account?.id || 'local-mac', null);
  document.documentElement.classList.add('native-app');
  document.body.classList.add('app-ready');
  el('auth-screen').hidden=true;
  el('account-controls').hidden=false;
  el('account-email').textContent=state.account?.email || 'On this Mac';
  el('connection-label').textContent=state.account ? 'Connected' : 'On this Mac';
  const signout=el('account-signout');
  signout.textContent=state.account ? 'Sign out' : 'Sign in';
  const error=el('account-error');
  // Account deletion remains in the web account page; native switching preserves local files.
  const deleteSection=el('account-delete-form').closest('details');deleteSection.hidden=true;
  deleteSection.before(error);
  const action=async (button,name)=>{
    button.disabled=true;error.textContent='';
    try { await nativeCall('account',{action:name}); }
    catch(failure) {error.textContent=failure.message;}
    finally {button.disabled=false;}
  };
  signout.onclick=()=>state.account?action(signout,'disconnect'):chooseNativeAccount(true);
  if(state.account) {
    const sync=document.createElement('button');sync.type='button';sync.className='text-btn';sync.textContent='Sync now';
    sync.onclick=()=>action(sync,'sync');signout.after(sync);
    const issue=document.createElement('p');issue.className='field-error';sync.after(issue);
    const retry=document.createElement('button');retry.type='button';retry.className='text-btn';retry.textContent='Retry pending changes';issue.after(retry);
    let current=state;
    const renderSync=value=>{
      current=value;
      const pending=(value.planPendingCount||0)+(value.pendingCount||0);
      issue.textContent=value.planSyncIssue||(pending?value.error:'')||'';retry.hidden=!issue.textContent;
      sync.disabled=Boolean(value.syncing);retry.disabled=Boolean(value.syncing);
    };
    retry.onclick=async()=>{
      if(current.planSyncUncertain&&!window.confirm('The last upload may already exist on the website. Check it before retrying. Retry anyway? This could create a duplicate.'))return;
      retry.disabled=true;
      try{await nativeCall('account',{action:'retryPlan',confirmUncertain:current.planSyncUncertain===true});}
      catch(failure){error.textContent=failure.message;}finally{retry.disabled=false;}
    };
    onNativeState(renderSync);renderSync(state);
  }
  const settings=document.createElement('button');settings.type='button';settings.className='text-btn';settings.textContent='Mac settings';
  settings.onclick=()=>action(settings,'settings');deleteSection.before(settings);
  return {onboarding:{automatic:true, version:state.onboarding?.version || 0,
    save:version=>nativeCall('api',{path:'/account/onboarding',method:'PATCH',body:{version}})}};
}


// The guest choice remains usable while cloud configuration loads or is offline.
async function chooseNativeAccount(returning=false) {
  const screen=el('auth-screen'), google=el('auth-google'), form=el('auth-form');
  const submit=el('auth-submit'), change=el('auth-change-email');
  const priorReady=document.body.classList.contains('app-ready');
  document.body.classList.remove('app-ready');screen.hidden=false;
  el('auth-loading').hidden=true;el('auth-google-option').hidden=false;
  el('auth-beta-note').textContent='Save on this Mac. Sign in for background sync, or start as a guest.';
  el('auth-google-label').textContent='Continue with Google';google.disabled=false;
  document.querySelector('.auth-privacy').innerHTML='<summary>About your data</summary><p>Guest work stays on this Mac. Account work syncs to your private cloud workspace. Signing in does not upload or merge guest work.</p>';
  form.hidden=true;el('auth-divider').hidden=true;form.inert=false;
  el('auth-retry').hidden=true;el('auth-error').textContent='';el('auth-status').textContent='';
  const guest=document.createElement('button');guest.className='native-guest secondary-btn';guest.type='button';
  guest.textContent=returning?'Back to workspace':'Continue as guest';form.after(guest);
  let busy=false, active=true, email='', providers=null;
  function setBusy(value) {
    busy=value;google.disabled=value;guest.disabled=value;submit.disabled=value;change.disabled=value;
    form.inert=value;google.setAttribute('aria-busy',String(value));
  }
  function resetEmail() {
    email='';el('auth-email').readOnly=false;el('auth-code').value='';el('auth-code').required=false;
    el('auth-code-row').hidden=true;change.hidden=true;submit.textContent='Send sign-in code';
    el('auth-status').textContent='';el('auth-error').textContent='';
  }
  resetEmail();
  const loadProviders=async()=>{
    try {
      providers=await nativeCall('account',{action:'providers'});
      if(!active)return;
      el('auth-google-option').hidden=providers.google===false;
      form.hidden=!providers.email;el('auth-divider').hidden=!(providers.google&&providers.email);
      el('auth-retry').hidden=true;if(!busy)el('auth-error').textContent='';
    } catch {
      if(!active||busy)return;
      el('auth-error').textContent='Cloud sign-in is taking longer to respond. You can continue locally or retry.';
      el('auth-retry').hidden=false;
    }
  };
  el('auth-retry').onclick=()=>{if(!busy)void loadProviders();};
  // No request to Supabase or the API is necessary to enter a guest workspace.
  void loadProviders();
  await new Promise(resolve=>{
    guest.onclick=async()=>{
      if(busy)return;setBusy(true);
      try {if(!returning)await nativeCall('account',{action:'continueLocal'});active=false;resolve();}
      catch(error){el('auth-error').textContent=error.message;setBusy(false);}
    };
    google.onclick=async()=>{
      if(busy)return;setBusy(true);el('auth-error').textContent='';el('auth-google-label').textContent='Connecting…';
      try {await nativeCall('account',{action:'connect'});location.reload();}
      catch(error){el('auth-error').textContent=error.message;setBusy(false);el('auth-google-label').textContent='Continue with Google';}
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!providers?.email)return;setBusy(true);el('auth-error').textContent='';
      try {
        if(!email) {
          const entered=el('auth-email').value.trim();
          await nativeCall('account',{action:'emailSend',email:entered});
          email=entered;el('auth-email').readOnly=true;el('auth-code-row').hidden=false;
          el('auth-code').required=true;change.hidden=false;submit.textContent='Verify and continue';
          el('auth-status').textContent=`Enter the sign-in code sent to ${email}.`;
        } else {await nativeCall('account',{action:'emailVerify',code:el('auth-code').value.trim()});location.reload();}
      } catch(error){el('auth-error').textContent=error.message;}
      finally{setBusy(false);if(email)el('auth-code').focus();}
    };
    change.onclick=async()=>{
      if(busy)return;
      try{await nativeCall('account',{action:'emailCancel'});resetEmail();el('auth-email').focus();}
      catch(error){el('auth-error').textContent=error.message;}
    };
  });
  guest.remove();form.onsubmit=null;screen.hidden=true;
  if(priorReady)document.body.classList.add('app-ready');
}
