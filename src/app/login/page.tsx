"use client"

import { useState, FormEvent } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Lock, User, Server, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

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
    <div className="relative min-h-screen w-full bg-[#0a0b0d] text-white flex flex-col justify-between overflow-hidden">
      {/* Dynamic Dark Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#141519] via-[#0d0e12] to-[#050507] opacity-90 z-0" />

      {/* Decorative Radial Glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-brand-red/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-brand-red/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full max-w-[1400px] mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <Image
            src="/logo_header.png"
            alt="UmrFlix Logo"
            width={160}
            height={40}
            className="h-9 w-auto object-contain transition-transform group-hover:scale-105"
            priority
          />
        </Link>
        <Link
          href="/"
          className="text-xs sm:text-sm text-gray-400 hover:text-white transition-colors"
        >
          Return to Guest View &rarr;
        </Link>
      </header>

      {/* Login Card */}
      <main className="relative z-10 w-full max-w-md mx-auto px-4 py-8">
        <div className="bg-[#141519]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/80 space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">Sign In</h1>
            <p className="text-xs text-gray-400">
              Sign in with your Jellyfin account to unlock streaming & personalized watchlists
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-3 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-3 p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Signed in successfully! Redirecting...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Jellyfin Username
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. josh"
                  required
                  className="w-full bg-[#1b1c22] border border-white/10 focus:border-brand-red rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-red transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#1b1c22] border border-white/10 focus:border-brand-red rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-red transition-all"
                />
              </div>
            </div>

            {/* Advanced Server Settings Accordion */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Custom Server URL</span>
                {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showAdvanced && (
                <div className="mt-2 space-y-1.5 animate-fadeIn">
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="http://localhost:8096"
                    className="w-full bg-[#1b1c22] border border-white/10 focus:border-brand-red rounded-xl py-2 pl-3 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-red"
                  />
                  <p className="text-[10px] text-gray-500">
                    Leave blank to use default configured Jellyfin server.
                  </p>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || success}
              className="w-full mt-4 bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-brand-red/25 flex items-center justify-center gap-2 text-sm tracking-wide"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-xs text-gray-600">
        <p>&copy; {new Date().getFullYear()} UmrFlix. Multi-User Jellyfin Authentication Enabled.</p>
      </footer>
    </div>
  )
}
