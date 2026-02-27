#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3331";
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BUILD_DIR = path.join(ROOT_DIR, "build");

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function replaceInFile(filePath, search, replacement) {
  const content = await fs.readFile(filePath, "utf8");
  if (!content.includes(search)) {
    return;
  }
  const updated = content.replace(new RegExp(search, "g"), replacement);
  await fs.writeFile(filePath, updated, "utf8");
}

async function replaceInDir(dir, search, replacement) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await replaceInDir(filePath, search, replacement);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".html")) {
      await replaceInFile(filePath, search, replacement);
    }
  }
}

async function build() {
  console.log(`Building frontend with API_BASE_URL: ${API_BASE_URL}`);
  
  // Remove existing build directory
  await fs.rm(BUILD_DIR, { recursive: true, force: true });
  
  // Copy public to build
  console.log(`Copying ${PUBLIC_DIR} to ${BUILD_DIR}...`);
  await copyDir(PUBLIC_DIR, BUILD_DIR);
  
  // Replace __API_BASE_URL__ with actual URL
  console.log("Replacing API_BASE_URL placeholders...");
  await replaceInDir(BUILD_DIR, "__API_BASE_URL__", API_BASE_URL);
  
  console.log(`Frontend build complete! Output: ${BUILD_DIR}`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
