import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const nextConfig: NextConfig = {
  turbopack: { root: resolve('.') },
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
