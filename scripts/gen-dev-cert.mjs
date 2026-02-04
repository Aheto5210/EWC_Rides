import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

function pickLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      if (!net) continue;
      if (net.family !== "IPv4") continue;
      if (net.internal) continue;
      candidates.push(net.address);
    }
  }

  const preferred = candidates.find(
    (ip) => ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."),
  );
  return preferred ?? candidates[0] ?? null;
}

const LAN_IP = (process.env.LAN_IP ?? "").trim() || pickLanIp();

const certDir = path.join(ROOT, ".cert");
await fs.mkdir(certDir, { recursive: true });

const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
const confPath = path.join(certDir, "openssl.cnf");

const altNames = [
  "DNS.1 = localhost",
  "IP.1 = 127.0.0.1",
  ...(LAN_IP ? [`IP.2 = ${LAN_IP}`] : []),
].join("\n");

const conf = `
[req]
prompt = no
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}
`.trimStart();

await fs.writeFile(confPath, conf, "utf8");

const args = [
  "req",
  "-x509",
  "-nodes",
  "-newkey",
  "rsa:2048",
  "-days",
  "3650",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-config",
  confPath,
];

const result = spawnSync("openssl", args, { stdio: "inherit" });
if (typeof result.status === "number" && result.status !== 0) {
  process.exit(result.status);
}
if (result.error) {
  // eslint-disable-next-line no-console
  console.error(result.error);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`\nWrote:\n- ${keyPath}\n- ${certPath}\n`);
if (LAN_IP) {
  // eslint-disable-next-line no-console
  console.log(`Next: start HTTPS and open https://${LAN_IP}:3443 on your phone.\n`);
}

