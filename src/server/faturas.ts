import { createServerFn } from '@tanstack/react-start'
import { appToday } from '#/lib/dates'
import { faturaPaymentInput } from './schemas'
import { listFaturasCore, markFaturaPaidCore, unmarkFaturaPaidCore } from './faturas.core'
import { requireUser } from './session.core'

export const listFaturas = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  return listFaturasCore(userId, appToday())
})

export const markFaturaPaid = createServerFn({ method: 'POST' })
  .validator((data: unknown) => faturaPaymentInput.parse(data))
  .handler(async ({ data }) => markFaturaPaidCore(await requireUser(), data))

export const unmarkFaturaPaid = createServerFn({ method: 'POST' })
  .validator((data: unknown) => faturaPaymentInput.parse(data))
  .handler(async ({ data }) => unmarkFaturaPaidCore(await requireUser(), data))
