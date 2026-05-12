#!/usr/bin/env bun

const version = process.env.OPENCODE_VERSION
if (!version) throw new Error("OPENCODE_VERSION is required")

const repo = process.env.GH_REPO || "trevor050/ulmcode"
const tag = `v${version}`
const releaseBase = `https://github.com/${repo}/releases/download/${tag}`

function sha(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

process.stdout.write(`class Ulmcode < Formula
  desc "ULMCode CLI for guided pentest orchestration"
  homepage "https://github.com/${repo}"
  version "${version}"
  license "PolyForm-Noncommercial-1.0.0"

  on_macos do
    if Hardware::CPU.arm?
      url "${releaseBase}/opencode-darwin-arm64.zip"
      sha256 "${sha("HOMEBREW_DARWIN_ARM64_SHA256")}"
    else
      url "${releaseBase}/opencode-darwin-x64-baseline.zip"
      sha256 "${sha("HOMEBREW_DARWIN_X64_SHA256")}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${releaseBase}/opencode-linux-arm64.tar.gz"
      sha256 "${sha("HOMEBREW_LINUX_ARM64_SHA256")}"
    else
      url "${releaseBase}/opencode-linux-x64-baseline.tar.gz"
      sha256 "${sha("HOMEBREW_LINUX_X64_SHA256")}"
    end
  end

  def install
    bin.install "ulmcode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ulmcode --version")
  end
end
`)
