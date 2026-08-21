"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2 } from "lucide-react"

export default function AvatarSelectionPage() {
  const router = useRouter()
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAvatar, setSavingAvatar] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch("/api/user/avatar")
        if (res.ok) {
          const data = await res.json()
          setAvatars(data.avatars || [])
          if (data.avatarUrl) {
            setSelectedAvatar(data.avatarUrl)
          }
        }
        
        const meRes = await fetch("/api/auth/me")
        if (meRes.ok) {
          const meData = await meRes.json()
          if (meData.authenticated && meData.user?.avatarUrl) {
            setSelectedAvatar((prev) => prev || meData.user.avatarUrl)
          }
        }
      } catch (err) {
        console.error("Error loading avatars:", err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  async function handleSelectAvatar(avatarUrl: string) {
    if (savingAvatar) return
    setSavingAvatar(avatarUrl)
    setSelectedAvatar(avatarUrl)

    try {
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      })

      if (!res.ok) {
        throw new Error("Failed to save avatar choice.")
      }

      setTimeout(() => {
        router.push("/")
        router.refresh()
      }, 300)
    } catch (err) {
      console.error("Failed to set avatar:", err)
      setSavingAvatar(null)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-black text-white pt-24 pb-20 px-4 sm:px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Minimal Heading */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white">
            Choose your avatar
          </h1>
        </div>

        {/* Avatars Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="size-10 text-amber-400 animate-spin" />
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
              Loading avatars...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4 md:gap-5">
            {avatars.map((avatarUrl) => {
              const isSelected = selectedAvatar === avatarUrl
              const isSaving = savingAvatar === avatarUrl

              return (
                <button
                  key={avatarUrl}
                  onClick={() => handleSelectAvatar(avatarUrl)}
                  disabled={Boolean(savingAvatar)}
                  className={`group relative aspect-square w-full rounded-none overflow-hidden transition-all duration-200 focus:outline-none ${
                    isSelected
                      ? "ring-4 ring-amber-400 scale-105 shadow-2xl shadow-amber-500/50 z-20"
                      : "hover:scale-110 hover:ring-2 hover:ring-white/80 hover:z-10 hover:shadow-xl hover:shadow-black/80"
                  }`}
                  title={`Select Avatar (${avatarUrl.split("/").pop()})`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarUrl}
                    alt="Profile Avatar Option"
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {isSelected && (
                    <div className="absolute top-1 right-1 bg-amber-400 text-black p-1 rounded-full shadow-md z-10 animate-in zoom-in duration-200">
                      <Check className="size-3.5 stroke-[3]" />
                    </div>
                  )}

                  {isSaving && (
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-30">
                      <Loader2 className="size-6 text-amber-400 animate-spin" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
