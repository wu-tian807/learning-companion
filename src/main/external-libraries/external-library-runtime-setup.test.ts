import { describe, expect, it, vi } from "vitest";

import {
  ExternalLibraryRuntimeSetupRegistry,
  type ExternalLibraryRuntimeSetup,
} from "./external-library-runtime-setup";

function setup(libraryId = "media-runtime"): ExternalLibraryRuntimeSetup {
  return {
    libraryId,
    isReady: vi.fn(async () => true),
    prepare: vi.fn(async () => undefined),
  };
}

describe("ExternalLibraryRuntimeSetupRegistry", () => {
  it("registers one setup per stable library id", () => {
    const registry = new ExternalLibraryRuntimeSetupRegistry();
    const registered = setup();

    registry.register(registered);

    expect(registry.find("media-runtime")).toBe(registered);
    expect(registry.find("missing")).toBeUndefined();
  });

  it("rejects malformed and duplicate registrations", () => {
    const registry = new ExternalLibraryRuntimeSetupRegistry();
    registry.register(setup());

    expect(() => registry.register(setup())).toThrow("REGISTRATION_CONFLICT");
    expect(() => registry.register(setup("../runtime"))).toThrow(
      "INVALID_EXTENSION_DEFINITION",
    );
  });
});
