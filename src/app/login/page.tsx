"use client"

import { useState, FormEvent, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { ChevronDown, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { sanitizeRedirectUrl } from "@/lib/url-sanitize"
import { getOrCreateDeviceId } from "@/lib/device-id"

function LoginForm() {
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
        window.location.href = redirectTarget
      }, 800)
    } catch {
      setError("Failed to connect to UmrFlix auth service.")
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-[374px] min-w-0">
      <h1 className="text-2xl font-bold tracking-tight text-white mb-6 text-left">
        Sign in to UmrFlix
      </h1>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-[4px] bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium animate-fadeIn mb-4 min-w-0 max-w-full">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2.5 p-3 rounded-[4px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium animate-fadeIn mb-4 min-w-0 max-w-full">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <span className="break-words min-w-0">Authenticated successfully! Redirecting...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 w-full min-w-0">
        {/* Username Input */}
        <div className="w-full min-w-0">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            required
            autoComplete="username"
            className="w-full min-w-0 max-w-full h-12 rounded-[4px] bg-penpot-surface border border-transparent focus:border-penpot-opacity-white-30 text-[16px] text-white placeholder-penpot-text-medium px-4 py-3.5 focus:outline-none transition-all box-border"
          />
        </div>

        {/* Password Input */}
        <div className="w-full min-w-0">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoComplete="current-password"
            className="w-full min-w-0 max-w-full h-12 rounded-[4px] bg-penpot-surface border border-transparent focus:border-penpot-opacity-white-30 text-[16px] text-white placeholder-penpot-text-medium px-4 py-3.5 focus:outline-none transition-all box-border"
          />
        </div>

        {/* Custom Server URL Collapsible */}
        <div className="pt-0.5 w-full min-w-0">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-penpot-text-medium/80 hover:text-white transition-colors cursor-pointer select-none py-1"
          >
            <span>Custom Server Url</span>
            <ChevronDown
              className={cn(
                "size-3.5 text-penpot-text-medium transition-transform duration-300 ease-out",
                showAdvanced ? "rotate-180" : "rotate-0"
              )}
            />
          </button>

          <div
            className={cn(
              "grid transition-all duration-300 ease-out w-full min-w-0",
              showAdvanced
                ? "grid-rows-[1fr] opacity-100 mt-2"
                : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
            )}
          >
            <div className="overflow-hidden space-y-1.5 w-full min-w-0">
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:8096"
                className="w-full min-w-0 max-w-full h-12 rounded-[4px] bg-penpot-surface border border-transparent focus:border-penpot-opacity-white-30 text-[16px] text-white placeholder-penpot-text-medium px-4 py-3.5 focus:outline-none transition-all box-border"
              />
              <p className="text-[11px] text-penpot-text-subtle break-words">
                Leave blank to use default configured Jellyfin server URL.
              </p>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || success}
          className="w-full min-w-0 max-w-full h-12 mt-6 rounded-[4px] bg-penpot-primary-300 hover:bg-penpot-primary-200 active:bg-penpot-primary-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-base tracking-[0.11em] uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.99]"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>CONTINUING...</span>
            </>
          ) : (
            <span>CONTINUE</span>
          )}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="relative min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-penpot-bg text-white flex flex-col items-center justify-center px-4 py-8 box-border">
      <main className="w-full max-w-[374px] min-w-0 flex flex-col items-center">
        {/* Centered UmrFlix Logo */}
        <div className="mb-10 flex items-center justify-center max-w-full">
          <Image
            src="/umrflix-logo.svg"
            alt="UmrFlix"
            width={171}
            height={54}
            className="h-[54px] w-auto max-w-full object-contain"
            priority
          />
        </div>

        {/* Login Form Panel */}
        <Suspense fallback={<div className="w-full h-[320px] rounded-[4px] bg-penpot-surface/40 animate-pulse" />}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  )
}


