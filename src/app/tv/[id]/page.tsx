import { TvDetail } from "@/components/TvDetail"

export default function TvPage({ params }: { params: Promise<{ id: string }> }) {
  return <TvDetail params={params} />
}
