import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { MediaCardFlyout } from "@/components/MediaCardFlyout"

afterEach(() => {
  cleanup()
})

// Mock Next.js router & image
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; unoptimized?: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fill, priority, unoptimized, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...rest} />
  },
}))

vi.mock("swr", () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
}))

vi.mock("@/components/BookmarkButton", () => ({
  BookmarkButton: () => <div data-testid="bookmark-button" />,
}))

vi.mock("@/components/AvailabilityBadge", () => ({
  AvailabilityBadge: () => <div data-testid="availability-badge" />,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("MediaCardFlyout Options Menu & Delete", () => {
  const dummyItem = {
    id: 12345,
    title: "Test Movie",
    overview: "A test movie overview description",
    poster_path: "/test.jpg",
    backdrop_path: "/test-backdrop.jpg",
    release_date: "2024-01-01",
    jellyfinItemId: "jf-12345",
  }

  const rect = { top: 100, left: 100, width: 240, height: 136 }

  it("renders vertical ellipsis button when onDelete is provided", () => {
    const onDelete = vi.fn()
    render(
      <MediaCardFlyout
        item={dummyItem}
        rect={rect}
        open={true}
        mediaType="movie"
        onDelete={onDelete}
      />
    )

    const moreButton = screen.getByRole("button", { name: /Options for Test Movie|More options/i })
    expect(moreButton).toBeDefined()
  })

  it("does not render vertical ellipsis button when onDelete is not provided", () => {
    render(
      <MediaCardFlyout
        item={dummyItem}
        rect={rect}
        open={true}
        mediaType="movie"
      />
    )

    const moreButton = screen.queryByRole("button", { name: /Options for Test Movie|More options/i })
    expect(moreButton).toBeNull()
  })

  it("opens dropdown menu with Delete button when vertical ellipsis is clicked and invokes onDelete", () => {
    const onDelete = vi.fn()
    render(
      <MediaCardFlyout
        item={dummyItem}
        rect={rect}
        open={true}
        mediaType="movie"
        onDelete={onDelete}
      />
    )

    const moreButton = screen.getByRole("button", { name: /Options for Test Movie|More options/i })
    fireEvent.click(moreButton)

    const deleteButton = screen.getByRole("button", { name: /Delete/i })
    expect(deleteButton).toBeDefined()

    fireEvent.click(deleteButton)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe("MediaCardFlyout play URL resolution", () => {
  const rect = { top: 100, left: 100, width: 240, height: 136 }

  const renderFlyout = (item: Parameters<typeof MediaCardFlyout>[0]["item"], mediaType: "movie" | "tv") =>
    render(<MediaCardFlyout item={item} rect={rect} open={true} mediaType={mediaType} />)

  it("routes series-level tv items through /watch series resolution (&type=tv)", () => {
    renderFlyout(
      {
        id: 999,
        name: "Test Series",
        overview: "A test series",
        poster_path: "/series.jpg",
        jellyfinItemId: "jf-series-1",
      },
      "tv",
    )

    const playLink = screen.getByRole("link", { name: /Play Test Series/i })
    expect(playLink.getAttribute("href")).toBe("/watch?id=jf-series-1&type=tv")
  })

  it("plays continue-watching episode ids directly (no &type=tv)", () => {
    renderFlyout(
      {
        id: 999,
        name: "Test Series",
        overview: "A test series",
        poster_path: "/series.jpg",
        jellyfinItemId: "jf-episode-7",
        episodeNumber: "S1:E7",
        episodeTitle: "The Pilot",
        progressPercent: 42,
      },
      "tv",
    )

    const playLink = screen.getByRole("link", { name: /Play Test Series/i })
    expect(playLink.getAttribute("href")).toBe("/watch?id=jf-episode-7")
  })

  it("plays movie ids directly (no &type=tv)", () => {
    renderFlyout(
      {
        id: 12345,
        title: "Test Movie",
        overview: "A test movie overview description",
        poster_path: "/test.jpg",
        jellyfinItemId: "jf-movie-1",
      },
      "movie",
    )

    const playLink = screen.getByRole("link", { name: /Play Test Movie/i })
    expect(playLink.getAttribute("href")).toBe("/watch?id=jf-movie-1")
  })

  it("falls back to tmdb-based play url when no jellyfin item id exists", () => {
    render(
      <MediaCardFlyout
        item={{
          id: 999,
          name: "Test Series",
          overview: "A test series",
          poster_path: "/series.jpg",
        }}
        rect={rect}
        open={true}
        mediaType="tv"
        availabilityState={{ status: "in_library" }}
      />,
    )

    const playLink = screen.getByRole("link", { name: /Play Test Series/i })
    expect(playLink.getAttribute("href")).toBe("/watch?tmdb=999&type=tv")
  })
})
