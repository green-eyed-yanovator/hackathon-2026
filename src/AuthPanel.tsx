import { useEffect, useState } from 'react'

import {
  supabase,
  supabasePublishableKey,
  supabaseUrl,
} from './lib/supabase'
import type { AuthMode } from './types'
import {
  inputStyle,
  labelStyle,
  linkButtonStyle,
  noticeStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from './ui'

type Provider = 'google' | 'github'

const providerNames: Record<Provider, string> = {
  google: 'Google',
  github: 'GitHub',
}

const titles: Record<AuthMode, string> = {
  signup: 'Create an account',
  login: 'Log in',
  'code-login': 'Log in with a code',
  reset: 'Reset your password',
  'new-password': 'Choose a new password',
}

type Props = {
  initialMode: AuthMode
  onClose: () => void
}

export default function AuthPanel({ initialMode, onClose }: Props) {
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [enabledProviders, setEnabledProviders] =
    useState<Record<string, boolean>>({})

  useEffect(() => {
    // The auth server lists which OAuth providers are configured, so an
    // unconfigured one shows a message instead of redirecting to an error page.
    fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    })
      .then((response) => response.json())
      .then((settings) => setEnabledProviders(settings.external ?? {}))
      .catch(() => {})
  }, [])

  function switchMode(next: AuthMode) {
    setMode(next)
    setPassword('')
    setConfirmPassword('')
    setCode('')
    setCodeSent(false)
    setMessage('')
  }

  const trimmedEmail = email.trim()
  const choosesPassword = mode === 'signup' || mode === 'new-password'
  const passwordsMatch = password === confirmPassword
  const usesCode = mode === 'code-login' || mode === 'reset'

  let formComplete: boolean
  let submitLabel: string

  switch (mode) {
    case 'signup':
      formComplete =
        name.trim() !== '' &&
        trimmedEmail !== '' &&
        password !== '' &&
        passwordsMatch
      submitLabel = 'Sign up'
      break
    case 'login':
      formComplete = trimmedEmail !== '' && password !== ''
      submitLabel = 'Log in'
      break
    case 'new-password':
      formComplete = password !== '' && passwordsMatch
      submitLabel = 'Save password'
      break
    case 'code-login':
    case 'reset':
      formComplete = codeSent
        ? code.trim().length === 6
        : trimmedEmail !== ''
      submitLabel = !codeSent
        ? 'Email me a code'
        : mode === 'reset'
          ? 'Verify code'
          : 'Log in'
      break
  }

  async function handleSubmit() {
    setMessage('')

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { display_name: name.trim() } },
      })

      if (error) {
        setMessage(error.message)
        return
      }

      // With email confirmation on (the hosted default) sign-up returns no session.
      if (!data.session) {
        setMessage('Check your email to confirm your account, then log in.')
        return
      }

      onClose()
      return
    }

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (error) {
        setMessage(error.message)
        return
      }

      onClose()
      return
    }

    if (mode === 'new-password') {
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setMessage(error.message)
        return
      }

      setPasswordSaved(true)
      return
    }

    // code-login and reset: first email a 6-digit code, then verify it.
    if (!codeSent) {
      const { error } =
        mode === 'reset'
          ? await supabase.auth.resetPasswordForEmail(trimmedEmail)
          : await supabase.auth.signInWithOtp({
              email: trimmedEmail,
              options: { shouldCreateUser: false },
            })

      if (error) {
        // Login codes never create accounts (shouldCreateUser: false).
        setMessage(
          error.code === 'otp_disabled'
            ? "There's no account with that email yet."
            : error.message,
        )
        return
      }

      setCodeSent(true)
      setMessage(`We emailed a 6-digit code to ${trimmedEmail}.`)
      return
    }

    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: code.trim(),
      type: mode === 'reset' ? 'recovery' : 'email',
    })

    if (error) {
      setMessage(error.message)
      return
    }

    // A verified reset code signs the user in; now they pick the new password.
    if (mode === 'reset') {
      switchMode('new-password')
      return
    }

    onClose()
  }

  async function handleProvider(provider: Provider) {
    if (!enabledProviders[provider]) {
      setMessage(`${providerNames[provider]} login isn't set up yet.`)
      return
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })

    if (error) {
      setMessage(error.message)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.35)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
        style={{
          width: '340px',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: 'white',
          borderRadius: '20px',
          padding: '24px',
          boxSizing: 'border-box',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
        }}
      >
        <h2
          style={{
            margin: '0 0 24px',
            fontSize: '24px',
            fontWeight: 700,
            color: '#111',
          }}
        >
          {titles[mode]}
        </h2>

        {passwordSaved ? (
          <>
            <p role="status" style={noticeStyle}>
              Your password has been updated.
            </p>
            <div style={{ display: 'flex' }}>
              <button
                type="button"
                onClick={onClose}
                style={primaryButtonStyle(true)}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {mode === 'signup' && (
              <>
                <label style={labelStyle}>Name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="How neighbours will see you"
                  autoComplete="nickname"
                  maxLength={50}
                  style={inputStyle}
                />
              </>
            )}

            {mode !== 'new-password' && (
              <>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={codeSent}
                  autoComplete="email"
                  style={inputStyle}
                />
              </>
            )}

            {(mode === 'login' || choosesPassword) && (
              <>
                <label style={labelStyle}>
                  {mode === 'new-password' ? 'New password' : 'Password'}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={
                    choosesPassword ? 'new-password' : 'current-password'
                  }
                  style={inputStyle}
                />
              </>
            )}

            {choosesPassword && (
              <>
                <label style={labelStyle}>Repeat password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  autoComplete="new-password"
                  style={{
                    ...inputStyle,
                    marginBottom:
                      confirmPassword && !passwordsMatch ? '6px' : '16px',
                  }}
                />
                {confirmPassword && !passwordsMatch && (
                  <p
                    style={{
                      margin: '0 0 16px',
                      fontSize: '13px',
                      color: '#b91c1c',
                    }}
                  >
                    Passwords don't match
                  </p>
                )}
              </>
            )}

            {usesCode && codeSent && (
              <>
                <label style={labelStyle}>Code</label>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit code from the email"
                  style={inputStyle}
                />
              </>
            )}

            {message && (
              <p role="alert" style={noticeStyle}>
                {message}
              </p>
            )}

            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              <button
                type="button"
                onClick={onClose}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={!formComplete}
                style={primaryButtonStyle(formComplete)}
              >
                {submitLabel}
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              {mode === 'login' && (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    style={linkButtonStyle}
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('code-login')}
                    style={linkButtonStyle}
                  >
                    Email me a login code instead
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    style={linkButtonStyle}
                  >
                    New here? Create an account
                  </button>
                </>
              )}

              {mode === 'signup' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  style={linkButtonStyle}
                >
                  Already have an account? Log in
                </button>
              )}

              {usesCode && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  style={linkButtonStyle}
                >
                  Back to log in
                </button>
              )}
            </div>

            {(mode === 'login' || mode === 'signup') && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  marginTop: '20px',
                  paddingTop: '20px',
                  borderTop: '1px solid #eee',
                }}
              >
                {(['google', 'github'] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => handleProvider(provider)}
                    style={secondaryButtonStyle}
                  >
                    Continue with {providerNames[provider]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </form>
    </div>
  )
}
