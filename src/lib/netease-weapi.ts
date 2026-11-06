import { crypto } from "crypto";

/**
 * 网易云 weapi 加密工具
 * 用于访问需要加密的网易云接口（获取歌曲 URL）
 */

const WEAPI_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const RSA_PUBKEY_E = "010001";
const RSA_PUBKEY_N =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

function aesEncrypt(text: string, key: string): string {
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(IV, "utf8")
  );
  return (
    cipher.update(text, "utf8", "base64") + cipher.final("base64")
  );
}

function rsaEncrypt(text: string): string {
  // 将 text 转为 hex（逆序）
  const reversed = text.split("").reverse();
  const hexStr = reversed
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  // RSA: result = text^e mod n
  const base = BigInt("0x" + hexStr);
  const exp = BigInt("0x" + RSA_PUBKEY_E);
  const mod = BigInt("0x" + RSA_PUBKEY_N);
  const result = modPow(base, exp, mod);
  return result.toString(16).padStart(256, "0");
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

export function weapiEncrypt(data: object): {
  params: string;
  encSecKey: string;
} {
  const text = JSON.stringify(data);
  // 第一层加密：用固定 key
  const enc1 = aesEncrypt(text, WEAPI_KEY);
  // 生成随机 secretKey
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let secretKey = "";
  for (let i = 0; i < 16; i++) {
    secretKey += chars[Math.floor(Math.random() * chars.length)];
  }
  // 第二层加密：用随机 key
  const enc2 = aesEncrypt(enc1, secretKey);
  // RSA 加密 secretKey
  const encSecKey = rsaEncrypt(secretKey);
  return { params: enc2, encSecKey };
}
