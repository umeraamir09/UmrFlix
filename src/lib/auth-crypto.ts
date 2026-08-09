export type UserSession = {
  userId: string
  username: string
  accessToken: string
  isAdmin: boolean
  enableDownloading: boolean
  maxParentalRating: string | null
  serverUrl: string
  avatarUrl?: string
  dailyRequestsCount?: number
  lastRequestResetDate?: string
}

export const COOKIE_NAME = "umrflix_session"
