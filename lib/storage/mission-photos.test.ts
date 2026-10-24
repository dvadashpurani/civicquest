import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_URL_SECONDS,
  MAX_SIGNED_URL_SECONDS,
  clampSignedUrlExpiry,
  isMissionPhotoPath,
  missionPhotoPath,
} from "./mission-photos";

// Contains hex letters so the uppercase cases really differ.
const SCHOOL = "a1b2c3d4-1111-4111-8111-abcdefabcdef";
const CLASS = "22222222-2222-4222-8222-222222222222";
const COMPLETION = "33333333-3333-4333-8333-333333333333";

describe("clampSignedUrlExpiry (Requirement 5.7)", () => {
  it("defaults to 300 seconds when missing or NaN", () => {
    expect(clampSignedUrlExpiry()).toBe(DEFAULT_SIGNED_URL_SECONDS);
    expect(clampSignedUrlExpiry(Number.NaN)).toBe(DEFAULT_SIGNED_URL_SECONDS);
  });

  it("never exceeds 600 seconds", () => {
    expect(clampSignedUrlExpiry(600)).toBe(600);
    expect(clampSignedUrlExpiry(601)).toBe(MAX_SIGNED_URL_SECONDS);
    expect(clampSignedUrlExpiry(Number.POSITIVE_INFINITY)).toBe(600);
  });

  it("is at least 1 second and whole", () => {
    expect(clampSignedUrlExpiry(0)).toBe(1);
    expect(clampSignedUrlExpiry(-30)).toBe(1);
    expect(clampSignedUrlExpiry(Number.NEGATIVE_INFINITY)).toBe(1);
    expect(clampSignedUrlExpiry(120.9)).toBe(120);
  });
});

describe("mission photo paths (Requirement 5.4)", () => {
  it("accepts school_id/class_id/completion_id.jpg", () => {
    expect(isMissionPhotoPath(`${SCHOOL}/${CLASS}/${COMPLETION}.jpg`)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["non-string", 42],
    ["wrong extension", `${SCHOOL}/${CLASS}/${COMPLETION}.png`],
    ["missing segment", `${CLASS}/${COMPLETION}.jpg`],
    ["extra segment", `${SCHOOL}/${SCHOOL}/${CLASS}/${COMPLETION}.jpg`],
    ["leading slash", `/${SCHOOL}/${CLASS}/${COMPLETION}.jpg`],
    ["traversal", `${SCHOOL}/../${COMPLETION}.jpg`],
    ["non-uuid segment", `${SCHOOL}/class-a/${COMPLETION}.jpg`],
    ["uppercase uuid", `${SCHOOL.toUpperCase()}/${CLASS}/${COMPLETION}.jpg`],
    ["trailing newline", `${SCHOOL}/${CLASS}/${COMPLETION}.jpg\n`],
  ])("rejects %s", (_label, path) => {
    expect(isMissionPhotoPath(path)).toBe(false);
  });

  it("builds a canonical lowercase path that validates", () => {
    const path = missionPhotoPath({
      schoolId: SCHOOL.toUpperCase(),
      classId: CLASS,
      completionId: COMPLETION,
    });
    expect(path).toBe(`${SCHOOL}/${CLASS}/${COMPLETION}.jpg`);
    expect(isMissionPhotoPath(path)).toBe(true);
  });

  it("refuses to build a path from a non-uuid id", () => {
    expect(missionPhotoPath({ schoolId: SCHOOL, classId: "../x", completionId: COMPLETION })).toBeNull();
  });
});
