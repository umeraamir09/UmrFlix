import { redirect } from "next/navigation"
import Link from "next/link"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { AlertCircle } from "lucide-react"

export default async function PartyJoinPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()

  if (!session) {
    redirect(`/login?redirect=/party/join/${id}`)
  }

  const snapshot = roomManager.joinRoom(
    id,
    session.userId,
    session.username || "Anonymous"
  )

  if (snapshot) {
    redirect(`/watch?party=${id}`)
  }

  return (
    <div className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
      <div className="p-3 rounded-full bg-red-500/20 text-red-400">
        <AlertCircle className="size-10" />
      </div>
      <h1 className="text-xl font-extrabold uppercase tracking-wider">
        Party Unavailable
      </h1>
      <p className="max-w-md text-sm text-gray-400">
        This watch party has ended or the invitation link is no longer valid.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-none bg-accent px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
      >
        Go to Home
      </Link>
    </div>
  )
}
