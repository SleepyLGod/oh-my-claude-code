export const PRODUCT_DISPLAY_NAME = 'Von Claude Code'

export function formatProductVersion(version: string): string {
  return `${PRODUCT_DISPLAY_NAME} v${version}`
}

export function formatCliVersionOutput(version: string): string {
  return `${version} (${PRODUCT_DISPLAY_NAME})`
}
