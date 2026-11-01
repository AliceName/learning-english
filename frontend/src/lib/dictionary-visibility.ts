const excludedRoutes = ["/account", "/settings", "/profile", "/admin/settings", "/admin/profile"];

export function isDictionaryVisible(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return !excludedRoutes.some(base => path === base || path.startsWith(`${base}/`));
}
