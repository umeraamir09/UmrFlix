"use client"

import { useState, FormEvent } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Lock, User, Server, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { LoginPosterWall } from "@/components/LoginPosterWall"

export default function LoginPage() {
  const router = useRouter()
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
        headers: { "Content-Type": "application/json" },
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
        router.push("/")
        router.refresh()
      }, 800)
    } catch {
      setError("Failed to connect to UmrFlix auth service.")
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground flex flex-col justify-between overflow-hidden">
      {/* 3D Tilted Dynamic Poster Wall Background */}
      <LoginPosterWall />

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
        <div className="rounded-none border border-border bg-surface p-8 shadow-2xl space-y-6">
          <div className="space-y-1.5 text-left border-b border-border pb-4">
            <h1 className="text-2xl font-black uppercase tracking-tight text-white">Sign In</h1>
            <p className="text-xs text-foreground-muted">
              Authenticate with your Jellyfin server account for personalized watchlists and requests.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-3 p-3.5 rounded-none bg-accent/10 border border-accent text-accent text-xs font-semibold animate-fadeIn">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-3 p-3.5 rounded-none bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold animate-fadeIn">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <span>Authenticated successfully! Redirecting...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-foreground-muted">
                Jellyfin Username
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  required
                  className="w-full rounded-none bg-background border border-border focus:border-accent text-sm text-white placeholder-muted py-3 pl-10 pr-4 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-foreground-muted">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-none bg-background border border-border focus:border-accent text-sm text-white placeholder-muted py-3 pl-10 pr-4 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Advanced Server Settings Accordion */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground-muted hover:text-white transition-colors"
              >
                <Server className="size-3.5" />
                <span>CUSTOM SERVER URL</span>
                {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>

              {showAdvanced && (
                <div className="mt-2 space-y-1.5 animate-fadeIn">
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="http://localhost:8096"
                    className="w-full rounded-none bg-background border border-border focus:border-accent text-xs text-white placeholder-muted py-2.5 px-3 focus:outline-none transition-colors"
                  />
                  <p className="text-[10px] text-muted">
                    Leave blank to use default configured Jellyfin server URL.
                  </p>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || success}
              className="w-full mt-4 rounded-none bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider py-3.5 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>AUTHENTICATING...</span>
                </>
              ) : (
                <span>SIGN IN</span>
              )}
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-xs font-medium text-muted border-t border-border-subtle">
        <p>&copy; {new Date().getFullYear()} UmrFlix. Multi-User Jellyfin Authentication.</p>
      </footer>
    </div>
  )
}
