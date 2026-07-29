import { Suspense } from "react"
import { Loader2 } from "lucide-react"
import { WatchPage } from "@/components/WatchPage"

export const metadata = {
  title: "Watching — UmrFlix",
}

export default function Watch() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh w-screen items-center justify-center bg-black">
          <Loader2 className="size-10 animate-spin text-accent" />
        </div>
      }
    >
      <WatchPage />
    </Suspense>
  )
}
