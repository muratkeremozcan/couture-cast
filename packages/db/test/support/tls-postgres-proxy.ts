// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: a Postgres endpoint shaped like a hosted one, for a client that has to verify it.
// It answers the SSLRequest, terminates TLS with a generated chain, sends the whole chain as the hosted
// pooler's self-signed root made visible, and forwards to the real database. Nothing here is committed
// key material: the keys are generated into a temporary directory and removed with it.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import tls from 'node:tls'

/** Reaches loopback and is not one of the hosts the TLS rules exempt as local. Node matches it to `localhost`. */
export const HOSTED_STYLE_HOST = 'localhost.'

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f])

export interface GeneratedChain {
  directory: string
  rootPath: string
  key: string
  chain: string
  remove: () => void
}

/** A root, an intermediate and a leaf for `dnsName`, the shape the Supabase poolers present. */
export function generateChain(dnsName = 'localhost'): GeneratedChain {
  const directory = mkdtempSync(path.join(tmpdir(), 'cc613-tls-'))
  const file = (name: string) => path.join(directory, name)
  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { stdio: 'pipe', cwd: directory })
  writeFileSync(
    file('ca.ext'),
    'basicConstraints=critical,CA:TRUE\nkeyUsage=keyCertSign\n'
  )
  writeFileSync(
    file('leaf.ext'),
    `subjectAltName=DNS:${dnsName}\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n`
  )
  for (const name of ['root', 'intermediate', 'leaf'])
    openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`)
  openssl(
    'req',
    '-x509',
    '-new',
    '-key',
    'root.key',
    '-days',
    '2',
    '-subj',
    '/CN=Test Root',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=keyCertSign',
    '-out',
    'root.pem'
  )
  openssl(
    'req',
    '-new',
    '-key',
    'intermediate.key',
    '-subj',
    '/CN=Test Intermediate',
    '-out',
    'intermediate.csr'
  )
  openssl(
    'x509',
    '-req',
    '-in',
    'intermediate.csr',
    '-CA',
    'root.pem',
    '-CAkey',
    'root.key',
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    'ca.ext',
    '-out',
    'intermediate.pem'
  )
  openssl(
    'req',
    '-new',
    '-key',
    'leaf.key',
    '-subj',
    `/CN=${dnsName}`,
    '-out',
    'leaf.csr'
  )
  openssl(
    'x509',
    '-req',
    '-in',
    'leaf.csr',
    '-CA',
    'intermediate.pem',
    '-CAkey',
    'intermediate.key',
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    'leaf.ext',
    '-out',
    'leaf.pem'
  )
  return {
    directory,
    rootPath: file('root.pem'),
    key: readFileSync(file('leaf.key'), 'utf8'),
    chain: ['leaf', 'intermediate', 'root']
      .map((name) => readFileSync(file(`${name}.pem`), 'utf8'))
      .join(''),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  }
}

export interface TlsProxy {
  port: number
  /** How many clients completed a TLS handshake, so a test can tell TLS from plaintext. */
  handshakes: () => number
  close: () => Promise<void>
}

/** `tls: false` answers the SSLRequest with `N`, as a server with no TLS does, and then closes. */
export async function startTlsProxy(options: {
  upstream: { host: string; port: number }
  chain?: GeneratedChain
  tls?: boolean
}): Promise<TlsProxy> {
  let handshakes = 0
  const sockets = new Set<net.Socket>()
  const server = net.createServer((client) => {
    sockets.add(client)
    client.on('error', () => undefined)
    client.once('close', () => sockets.delete(client))
    client.once('data', (first) => {
      if (!first.subarray(0, 8).equals(SSL_REQUEST) || options.tls === false) {
        if (first.subarray(0, 8).equals(SSL_REQUEST)) client.end('N')
        else client.destroy()
        return
      }
      const secure = new tls.TLSSocket(client, {
        isServer: true,
        key: options.chain!.key,
        cert: options.chain!.chain,
      })
      secure.on('error', () => undefined)
      secure.once('secure', () => {
        handshakes += 1
        const upstream = net.connect(options.upstream)
        sockets.add(upstream)
        upstream.on('error', () => secure.destroy())
        upstream.once('close', () => sockets.delete(upstream))
        secure.pipe(upstream).pipe(secure)
      })
      client.write('S')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  return {
    port,
    handshakes: () => handshakes,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
