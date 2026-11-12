/**
 * Escribe src/theme/tokens.css desde src/theme/*.ts (ver generateTokensCss en apply.ts).
 * Uso: npm run gen:tokens
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateTokensCss } from "../src/theme/apply";

const out = path.resolve(__dirname, "../src/theme/tokens.css");
writeFileSync(out, generateTokensCss());
console.log(`ok ${out}`);
