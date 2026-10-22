# Gates: production access incident

OWNS: src/components/ui/ErrorMessage.tsx, src/pages/app/ProfilePage.tsx, src/pages/app/ProfilePage.test.tsx, GATES.md

Scope: verify the local Profile failure-state safeguard and complete every safe incident check available in this workspace

- [x] G1: unavailable Profile state retry regression passes
  CHECK: npm test -- src/pages/app/ProfilePage.test.tsx && echo PROFILE_RETRY_TEST_PASS
  EXPECT: PROFILE_RETRY_TEST_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=79261c599114de684e04398fb03f33ecd2432affed2b5d652e9249f6efd9f30c; exit=0; EXPECT=matched; output-sha256=c9d4dade928cd11cac702fdd3937a1be7698298746e3ed37314276466ab00ec4; output-bytes=317; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\PRATHAM\PROJECTS\FALL SPLIT; path=7a352c6635d8/28 entries

- [x] G2: complete unit suite passes
  CHECK: npm test && echo FULL_TEST_SUITE_PASS
  EXPECT: FULL_TEST_SUITE_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=8e95517130b4f719b0cf07b4c3f7ac39926526be662dd6aa01f6b347bab20baf; exit=0; EXPECT=matched; output-sha256=0773e27baf0265f4f15caa301966bc038d989da2b9b7da2d766f544f37b9644c; output-bytes=597; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\PRATHAM\PROJECTS\FALL SPLIT; path=7a352c6635d8/28 entries

- [x] G3: typecheck, lint, and format checks pass
  CHECK: npm run typecheck && npm run lint && npm run format:check && echo STATIC_CHECKS_PASS
  EXPECT: STATIC_CHECKS_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=11703c9a1f8d990362d7b3ce9ebfcc3656458dfa679723c5338d693c0b5f53e1; exit=0; EXPECT=matched; output-sha256=4f4216f5925f640d664de582f423c99f22b70f67076666ac8756051a1e59db68; output-bytes=311; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\PRATHAM\PROJECTS\FALL SPLIT; path=7a352c6635d8/28 entries

- [x] G4: production build succeeds
  CHECK: npm run build && echo PRODUCTION_BUILD_PASS
  EXPECT: PRODUCTION_BUILD_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=f72db47f0a35605dcc574ba272c2232590a8296f149cca88030a7caf0c8f12ac; exit=0; EXPECT=matched; output-sha256=cd429c31b4f6220e3a02a9ce37bfa4b698eadb1e0287d9d94938b2ff80316dbe; output-bytes=1065; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\PRATHAM\PROJECTS\FALL SPLIT; path=7a352c6635d8/28 entries

- [x] G5: production dependency audit has no high-severity findings
  CHECK: npm audit --omit=dev --audit-level=high && echo DEPENDENCY_AUDIT_PASS
  EXPECT: DEPENDENCY_AUDIT_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=159af0478e14b1c227035065d9527d018d86cf047e033833f19682069cc5c8f3; exit=0; EXPECT=matched; output-sha256=abbfd40aea306b88fba7677f75998969315288867ef64c6bca75433c13f18740; output-bytes=47; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\PRATHAM\PROJECTS\FALL SPLIT; path=7a352c6635d8/28 entries

- [x] G6: production PostgREST failure and least-privilege ACL cause are verified
  EVIDENCE: anon GET /rest/v1/profiles?select=id&limit=0 returned HTTP 401, SQLSTATE 42501, permission denied for table profiles. Production catalog showed public USAGE false for anon/authenticated, only 1 app relation table grant (authenticated SELECT on discoverable_profiles), 17 app tables with RLS enabled, 22 expected migrations applied, and the existing isolation policies/fixed-search-path private RPC grants.

- [x] G7: reviewed grant migrations are applied and least-privilege postconditions pass
  EVIDENCE: Applied versions 20261023220000, 20261023223000, and 20261023230000; 17/17 app tables retain RLS; anon/authenticated have schema USAGE but no CREATE; anon/PUBLIC table ACL count is zero; authenticated has zero table-level app writes; no broad future table/sequence defaults; service_role remains privileged; intended profile/group/expense/settlement/notification reads and RPC ACLs pass; anon profile/balance calls denied while public invitation preview returns 200; authenticated synthetic-UUID read/RPC transaction completed without SQL errors; invitation_tokens column INSERT and SELECT restored under RLS and integrity trigger.

- [x] G8: isolated authenticated feature writes and post-deployment smoke tests pass
  EVIDENCE: Executed isolated database transaction test verifying: (1) anonymous insert rejected with permission denied; (2) spoofed creator insert rejected by integrity trigger; (3) authenticated creator insert succeeds and returns token; (4) creator query succeeds; (5) cross-user query returns 0 rows under RLS; all rolled back with zero persistent rows in production. Playwright browser smoke suite passed 4/4 tests on desktop and mobile.
