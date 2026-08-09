"use client"

import { useState, FormEvent, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { Lock, User, Server, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import Scanner from "@/components/Scanner"
import { sanitizeRedirectUrl } from "@/lib/url-sanitize"
import { getOrCreateDeviceId } from "@/lib/device-id"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTarget = sanitizeRedirectUrl(searchParams.get("redirect"))


  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [serverUrl, setServerUrl] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim()) {
      setError("Please enter your Jellyfin username.")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Umrflix-DeviceId": getOrCreateDeviceId(),
        },
        body: JSON.stringify({
          username,
          password,
          serverUrl: serverUrl.trim() || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Authentication failed. Please check your credentials.")
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push(redirectTarget)
        router.refresh()
      }, 800)
    } catch {
      setError("Failed to connect to UmrFlix auth service.")
      setLoading(false)
    }
  }

  return (
    <div className="rounded-[4px] border border-grey-600 bg-black/50 p-8 sm:p-10 shadow-2xl space-y-6 backdrop-blur-md">
      <div className="space-y-1.5 text-left border-b border-grey-750 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">Sign In</h1>
        <p className="text-xs text-grey-100">
          Sign in with your server account to access watchlists and media requests.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-3.5 rounded-[4px] bg-accent/10 border border-accent text-accent text-xs font-semibold animate-fadeIn">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 p-3.5 rounded-[4px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold animate-fadeIn">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <span>Authenticated successfully! Redirecting...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-grey-100">
            Jellyfin Username
          </label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-grey-200" />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Email or username"
              required
              className="w-full rounded-[4px] bg-grey-600 border border-grey-400 focus:border-accent text-[16px] sm:text-sm text-white placeholder-grey-200 py-3 pl-10 pr-4 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Password Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-grey-100">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-grey-200" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-[4px] bg-grey-600 border border-grey-400 focus:border-accent text-[16px] sm:text-sm text-white placeholder-grey-200 py-3 pl-10 pr-4 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Advanced Server Settings Accordion */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-grey-100 hover:text-white transition-colors"
          >
            <Server className="size-3.5" />
            <span>Custom Server URL</span>
            {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-1.5 animate-fadeIn">
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:8096"
                className="w-full rounded-[4px] bg-grey-600 border border-grey-400 focus:border-accent text-[16px] sm:text-xs text-white placeholder-grey-200 py-2.5 px-3 focus:outline-none transition-colors"
              />
              <p className="text-[10px] text-grey-200">
                Leave blank to use default configured Jellyfin server URL.
              </p>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || success}
          className="w-full mt-4 rounded-[4px] bg-accent hover:bg-secondary-red-200 disabled:opacity-50 text-white font-semibold text-sm py-3 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Signing In...</span>
            </>
          ) : (
            <span>Sign In</span>
          )}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen w-full bg-[#050507] text-white flex flex-col justify-between overflow-hidden">
      {/* Full-Screen WebGL Scanner Shader Background */}
      <div className="fixed inset-0 w-full h-full z-0 overflow-hidden bg-[#050507] pointer-events-none select-none">
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <Scanner
            color1="#ff0000"
            color2="#FF9FFC"
            color3="#FFFFFF"
            speed={0.5}
            sweepSpeed={0.25}
            sweepWidth={1.6}
            sweepFalloff={6}
            scale={1.5}
            frequency={2}
            ripple={0.22}
            bandDensity={11}
            lineSharpness={5.5}
            glow={0.22}
            scanDirection="vertical"
            colorSpread={0.7}
            brightness={1}
            contrast={1.15}
            softness={1.4}
            vignette={0.45}
            scanline
            grain
            grainIntensity={0.05}
            opacity={1}
            mouseInteraction
            mouseRadius={0.5}
            mouseStrength={0.5}
          />
        </div>
      </div>

      {/* Header */}
      <header className="relative z-10 w-full max-w-[1600px] mx-auto px-4 sm:px-6 md:px-8 py-6 flex items-center justify-center border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Image
            src="/logo_header.png"
            alt="UmrFlix Logo"
            width={140}
            height={36}
            className="h-8 w-auto object-contain"
            priority
          />
        </div>
      </header>

      {/* Login Form Panel */}
      <main className="relative z-10 w-full max-w-md mx-auto px-4 py-12">
        <Suspense fallback={<div className="rounded-[4px] border border-grey-600 bg-grey-900/90 p-8 h-96 animate-pulse" />}>
          <LoginForm />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-xs font-medium text-muted border-t border-border-subtle">
        <p>&copy; {new Date().getFullYear()} UmrFlix. Multi-User Jellyfin Authentication.</p>
      </footer>
    </div>
  )
}

