import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { db } from '#/db/index'
import { oauthApplication } from '#/db/auth-schema'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const getClient = createServerFn({ method: 'GET' })
  .validator((data: unknown) => String((data as { clientId: string }).clientId))
  .handler(async ({ data: clientId }) => {
    const [row] = await db.select({ name: oauthApplication.name, redirectUrls: oauthApplication.redirectUrls })
      .from(oauthApplication).where(eq(oauthApplication.clientId, clientId))
    if (!row) throw new Error('Aplicativo desconhecido')
    return { name: row.name, redirectUrls: row.redirectUrls.split(',') }
  })

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: (search: Record<string, unknown>) => ({
    consent_code: String(search.consent_code ?? ''),
    client_id: String(search.client_id ?? ''),
    scope: String(search.scope ?? ''),
  }),
  beforeLoad: ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/login' })
  },
  loaderDeps: ({ search }) => ({ clientId: search.client_id }),
  loader: ({ deps }) => getClient({ data: { clientId: deps.clientId } }),
  component: Consent,
})

function Consent() {
  const client = Route.useLoaderData()
  const { consent_code, scope } = Route.useSearch()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const decide = async (accept: boolean) => {
    setPending(true)
    setError('')
    const response = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accept, consent_code }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.redirectURI) {
      setPending(false)
      setError(body?.error_description || 'Não foi possível concluir a autorização')
      return
    }
    window.location.href = body.redirectURI
  }

  return (
    <main className="page-wrap flex min-h-[70vh] items-center justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Autorizar acesso</CardTitle>
          <CardDescription>
            <strong>{client.name || 'Um aplicativo'}</strong> quer acessar as suas finanças.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Se você autorizar, o aplicativo poderá ler e criar contas, transações, tags, faturas
            e recorrências em seu nome, até você revogar o acesso.
          </p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Redireciona para</dt>
              <dd className="break-all font-mono">{client.redirectUrls.join(', ')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Escopos</dt>
              <dd className="break-all font-mono">{scope || 'openid'}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            Só autorize se você mesmo iniciou esta conexão e reconhece o endereço acima.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => decide(true)}>Autorizar</Button>
            <Button className="flex-1" variant="outline" disabled={pending} onClick={() => decide(false)}>Recusar</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
