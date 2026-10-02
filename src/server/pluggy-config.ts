/** Pluggy env config (no I/O). Sync is disabled unless credentials and at least one item are set. */
export const pluggyItemIds = () => (process.env.PLUGGY_ITEM_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)

export const pluggyEnabled = () =>
  !!process.env.PLUGGY_CLIENT_ID && !!process.env.PLUGGY_CLIENT_SECRET && pluggyItemIds().length > 0
