import { createVerify } from "crypto";

export function create_verify(publicKeyPem: string) {
  function verify(message: string, signatureB64: string): boolean {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, signatureB64, "base64");
  }
  return verify;
}
