# Private repository and VPS updates

The running service reads the question bank on the server and returns only the current learner's permitted exam data. It does not need a public GitHub repository. Changing GitHub visibility does not retract earlier downloads or public forks. Review the existing public history and treat previous copies as potentially retained elsewhere.

## Update without a GitHub key on the VPS

1. Pull/update the local repository using the owner's existing authenticated GitHub connection. Review changes, run `npm test`, commit and push.
2. Run `ops/New-Release.ps1` in PowerShell. It packages the exact committed files and writes a SHA256 manifest under the ignored `private/releases` directory. Neither ignored credentials nor the live database is included.
3. Upload the archive to the VPS with the owner's existing authenticated SSH/SCP access. Do not put a password, private SSH key or GitHub token into a command, repository or chat. The owner must complete any authentication or unfamiliar host-key confirmation directly. No new server credential is required by these scripts.
4. Close enrollment for maintenance. From the existing VPS console, run the current trusted `ops/deploy-uploaded-release.sh` with the uploaded archive path, full revision and checksum from the local manifest. Verify the checksum independently of the uploaded archive, using the local manifest.
5. The deployer checks archive paths and types, installs locked dependencies, runs tests, checks database backups and restoration, switches releases, restarts services and checks that sales remain closed. It keeps the prior release and protected configuration. It does not collect payments, approve policies, configure taxes or open enrollment.
6. Review the live site and student portal. Update code while the repository stays private; the VPS does not download a public GitHub archive in this workflow.

The first installation of this deployer must use a trusted console/session and the reviewed source. Preserve the uploaded archive privately as required by the owner's retention policy. The code rollback cannot reverse a destructive database migration; this release only adds tables.

## One-time policy routing

Apache must proxy `/mcip/policies/` to `http://127.0.0.1:18491/mcip/policies/` and `/mcip-sandbox/policies/` to the corresponding port18492 path, with matching `ProxyPassReverse` rules. Require HTTPS as for the existing student/API paths. Check Apache configuration before a graceful reload.

## Policy publication and sales

`POLICIES_APPROVED=false` keeps proposed pages visibly marked as owner-review drafts. `LAUNCH_APPROVED=false` keeps checkout and registration closed independently of the enrollment switch. Do not set either flag by inference. Finalize the policy content and version, review seller details and retention operations, obtain owner approval, then complete the separate tax/launch review before opening sales. Tax setup is currently deferred at the owner's request.

Student agreements preserve the exact policy document, digest, version, learner and acceptance time. Each checkout has its own agreement receipt. A change to previously accepted content requires a new version. Back up these records with the private student database.
