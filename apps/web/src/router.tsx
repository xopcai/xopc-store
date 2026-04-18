import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { Shell } from "@/components/Shell"
import { fetchMe, logout, type CurrentUser } from "@/lib/api"
import { HomePage } from "@/pages/HomePage"
import { PackageDetailPage } from "@/pages/PackageDetailPage"
import { DeveloperPage } from "@/pages/DeveloperPage"
import { PublishPage } from "@/pages/PublishPage"
import { AdminPage } from "@/pages/AdminPage"
import { AuthCallbackPage } from "@/pages/AuthCallbackPage"
import { AuthTokenPage } from "@/pages/AuthTokenPage"

export type RouterContext = {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  const qc = useQueryClient()
  const { data: user } = useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: fetchMe,
  })
  const onLogin = () => {
    window.location.href = "/api/v1/auth/github?mode=web"
  }
  const onLogout = async () => {
    await logout()
    await qc.invalidateQueries({ queryKey: ["me"] })
  }
  return (
    <Shell user={user ?? null} onLogin={onLogin} onLogout={onLogout}>
      <Outlet />
    </Shell>
  )
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
})

const packageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packages/$name",
  component: PackageDetailPage,
})

const developerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/developer",
  component: DeveloperPage,
})

const publishRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/developer/publish",
  component: PublishPage,
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  component: AuthCallbackPage,
})

const authTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/token",
  component: AuthTokenPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  packageRoute,
  developerRoute,
  publishRoute,
  adminRoute,
  authCallbackRoute,
  authTokenRoute,
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  })
}
