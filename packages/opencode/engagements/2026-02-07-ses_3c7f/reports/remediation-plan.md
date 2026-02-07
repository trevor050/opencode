# Remediation Plan - Detailed Implementation Guide

**Engagement**: 2026-02-07-ses_3c7f  
**Target**: Trevors-MacBook-Air.local (192.168.1.224)  
**Plan Version**: 1.0  
**Date**: February 7, 2026

---

## Executive Overview

This document provides a detailed, phased remediation plan to address the six findings identified in the security assessment. The plan is designed to be implementable by the system owner with clear steps, timelines, and success criteria.

**Risk Reduction by Phase**:

- Phase 1 (IMMEDIATE): 30 minutes effort → 60% risk reduction
- Phase 2 (SHORT-TERM): 60 minutes effort → 30% additional risk reduction
- Phase 3 (ONGOING): Monthly reviews → sustained posture (10% continuous improvement)

---

## PHASE 1: IMMEDIATE REMEDIATION (This Week)

### Objective

Eliminate HIGH-severity findings and establish basic security controls

**Timeline**: Complete all items within 7 days (preferably within 48 hours)  
**Total Effort**: ~30 minutes  
**Risk Reduction**: 60%  
**Success Criteria**: Redis requires authentication, rapportd is disabled, port 50776 service is identified

---

### Action 1.1: Enable Redis Authentication (FND-SES8G4F0Z4)

**Priority**: CRITICAL (Highest)  
**Effort**: 15 minutes  
**Risk Reduction**: 95% for this finding  
**Difficulty**: EASY

**Prerequisite Knowledge**: Basic terminal commands, password management

**Steps**:

1. **Generate Strong Password**

   ```bash
   # Generate 32-character random password (copy output to secure location)
   openssl rand -hex 32
   # Output example: a3f7d9c2b1e4g6h8i0j2k4l6m8n0o2p4
   ```

   - Save this password in your password manager (NOT in code, config files, or git)
   - This is your Redis master password

2. **Set Authentication in Redis**

   ```bash
   # Connect to Redis and set password
   redis-cli -h 127.0.0.1 -p 6379 CONFIG SET requirepass "a3f7d9c2b1e4g6h8i0j2k4l6m8n0o2p4"

   # Response should be: OK
   ```

3. **Verify Password is Set**

   ```bash
   # Try to connect without password (should fail)
   redis-cli -h 127.0.0.1 -p 6379 PING
   # Expected: (error) NOAUTH Authentication required

   # Connect with password (should succeed)
   redis-cli -h 127.0.0.1 -p 6379 -a "a3f7d9c2b1e4g6h8i0j2k4l6m8n0o2p4" PING
   # Expected: PONG
   ```

4. **Make Password Persistent**

   ```bash
   # Find redis.conf file (usually in /opt/homebrew/etc/ on macOS)
   find /opt/homebrew -name "redis.conf" 2>/dev/null

   # Edit redis.conf and find the line:
   # requirepass foobared
   # Change it to:
   requirepass a3f7d9c2b1e4g6h8i0j2k4l6m8n0o2p4

   # Save the file
   ```

5. **Restart Redis to Load Configuration**

   ```bash
   # Restart via Homebrew Services
   brew services restart redis

   # Verify it's running
   brew services list | grep redis
   # Expected: redis started under your user
   ```

6. **Final Verification**

   ```bash
   # Verify Redis still requires authentication after restart
   redis-cli -h 127.0.0.1 -p 6379 PING
   # Expected: (error) NOAUTH Authentication required

   # Verify it works with password
   redis-cli -h 127.0.0.1 -p 6379 -a "a3f7d9c2b1e4g6h8i0j2k4l6m8n0o2p4" INFO server
   # Expected: Server section with version 8.0.0
   ```

**Update Application Configuration**:

- If any application connects to Redis, update connection string to include authentication:
  - Before: `redis://127.0.0.1:6379`
  - After: `redis://:password@127.0.0.1:6379`

**Success Criteria**:

- ✅ Redis requires password for any connection
- ✅ `redis-cli PING` without password returns authentication error
- ✅ `redis-cli -a [password] PING` returns PONG
- ✅ Configuration persists after Redis restart

---

### Action 1.2: Disable Apple Diagnostics Reporting Service (FND-QKC74KB5QE)

**Priority**: CRITICAL (Highest)  
**Effort**: 5 minutes  
**Risk Reduction**: 80% for this finding  
**Difficulty**: EASY

**Steps**:

1. **Disable Analytics via System Preferences**

   ```
   System Preferences
   → Security & Privacy
   → Analytics
   → UNCHECK: Share Mac Analytics
   → UNCHECK: Share iCloud Analytics
   → UNCHECK: Improve Siri & Dictation
   ```

2. **Unload rapportd Service**

   ```bash
   # Unload rapportd (permanently, survives reboots)
   sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.rapportd.plist
   # Password prompt: Enter your macOS login password
   # Expected output: Unload: /System/Library/LaunchDaemons/com.apple.rapportd.plist
   ```

3. **Verify rapportd is Disabled**

   ```bash
   # Check if rapportd is still running
   sudo launchctl list | grep rapportd
   # Expected: No output (service not listed)

   # Verify port 55992 is no longer listening
   netstat -an | grep 55992
   # Expected: No output (port not in LISTEN state)

   # Double-check with lsof
   sudo lsof -i :55992
   # Expected: No output or "command: COMMAND PID ... TYPE NAME" header only (no rapportd)
   ```

4. **Restart System to Confirm**

   ```bash
   # Reboot MacBook
   sudo reboot

   # After restart, verify again
   netstat -an | grep 55992
   # Expected: No output (port still not listening)
   ```

**Success Criteria**:

- ✅ Analytics settings disabled in System Preferences
- ✅ `sudo launchctl list | grep rapportd` returns no results
- ✅ `netstat -an | grep 55992` returns no results
- ✅ Port 55992 remains closed after system restart

---

### Action 1.3: Identify Unknown Service on Port 50776 (FND-0XHYD38Y0E)

**Priority**: HIGH  
**Effort**: 10 minutes  
**Risk Reduction**: 50% (context-dependent)  
**Difficulty**: MEDIUM

**Objective**: Determine what service owns port 50776, enabling informed remediation decision in Phase 2

**Steps**:

1. **Find Process Owning Port 50776**

   ```bash
   # Use lsof to find the process
   sudo lsof -i :50776

   # Output will show:
   # COMMAND   PID USER  FD TYPE             DEVICE SIZE/OFF NODE NAME
   # [service] [P] [U]   [FD] [TYPE]        ... TCP *:50776 (LISTEN)

   # Note the COMMAND and PID
   ```

2. **Get More Information on the Process**

   ```bash
   # Replace [PID] with actual PID from previous step
   ps aux | grep [PID]

   # Find full path to executable
   ps -p [PID] -o comm=

   # Or use
   which [service_name]
   ```

3. **Determine Service Version and Purpose**

   ```bash
   # Common version flag approaches
   /path/to/service --version
   /path/to/service -v
   /path/to/service --help

   # Check if it's a Homebrew package
   brew list | grep [service_name]
   brew info [service_name]

   # Check if it's a system service
   ls -la /System/Library/LaunchDaemons/com.*.plist | grep [service_name]
   ls -la /Library/LaunchDaemons/ | grep [service_name]
   ```

4. **Check for CVEs and Documentation**

   ```bash
   # Search NIST NVD for [service_name]
   # https://nvd.nist.gov/vuln/search

   # Check if service should be running
   grep -r "[service_name]" ~/.bash_profile ~/.zshrc ~/.config/

   # Check git history for when service was installed
   git log --all --source --grep="[service_name]"
   ```

5. **Document Findings**
   ```bash
   # Create a note with:
   # - Service name
   # - PID and process path
   # - Version
   # - Installation date (if available)
   # - Purpose (required / development / legacy)
   # - CVE status (no known issues / has patches / etc)
   ```

**Common Outcomes**:

| Finding                                    | Action                                               | Timeline            |
| ------------------------------------------ | ---------------------------------------------------- | ------------------- |
| Development service (Node.js, test server) | Document and move to Phase 2 for binding restriction | Phase 2             |
| Legitimate system service                  | Document purpose, restrict binding in Phase 2        | Phase 2             |
| Unneeded legacy service                    | Uninstall in Phase 2                                 | Phase 2             |
| Unknown/suspicious service                 | Investigate further, may warrant manual review       | Phase 2 or external |

**Success Criteria**:

- ✅ Identified the service name
- ✅ Found the service version
- ✅ Determined if service is required
- ✅ Documented findings for Phase 2 remediation

---

## PHASE 2: SHORT-TERM REMEDIATION (This Month)

### Objective

Reduce MEDIUM-severity findings and establish comprehensive security configuration

**Timeline**: Complete all items within 30 days  
**Total Effort**: ~60 minutes  
**Risk Reduction**: 30% additional (cumulative 90%+)  
**Prerequisites**: Phase 1 actions must be complete

---

### Action 2.1: Configure System Firewall (FND-YCZS3WNSCZ)

**Priority**: HIGH  
**Effort**: 20 minutes  
**Risk Reduction**: 50% for this finding  
**Difficulty**: MEDIUM

**Steps**:

1. **Enable Firewall**

   ```
   System Preferences
   → Security & Privacy
   → Firewall
   → Click "Turn On Firewall"
   ```

2. **Configure Firewall Rules**

   ```
   System Preferences
   → Security & Privacy
   → Firewall
   → Click "Firewall Options..."

   Enable:
   ☑ Enable stealth mode (hide from network scanning)
   ☑ Automatically allow signed software to accept incoming connections
   ☑ Enable logging (optional, for monitoring)
   ```

3. **Review and Configure Specific Rules**

   ```
   Firewall Options → Click "+" to add exceptions if needed:

   For essential services (SSH, remote management):
   - Allow: SSH (Port 22) - only if remote access needed
   - Allow: HTTPS (Port 443) - if hosting web services

   For restrictive mode:
   - Block all inbound except what you explicitly allow
   ```

4. **Verify Firewall is Active**

   ```bash
   # Check firewall status from terminal
   defaults read /Library/Preferences/com.apple.alf globalstate
   # Expected output: 1 (firewall enabled)

   # List current firewall rules
   sudo /usr/libexec/alf/aftop -s
   ```

**Success Criteria**:

- ✅ Firewall appears as "On" in System Preferences
- ✅ Stealth mode enabled
- ✅ Test from LAN device: `ping 192.168.1.224` (should timeout)
- ✅ Test firewall is not blocking required services (applications work normally)

---

### Action 2.2: Enable IPv6 Privacy Extensions (FND-YCZS3WNSCZ)

**Priority**: MEDIUM  
**Effort**: 10 minutes  
**Risk Reduction**: 40% for this finding  
**Difficulty**: EASY

**Steps**:

1. **Open Network Settings**

   ```
   System Preferences
   → Network
   → Select "Wi-Fi" (or active connection)
   → Click "Advanced..."
   → Select "IPv6" tab
   ```

2. **Enable Privacy Addressing**

   ```
   IPv6 Configuration: Select "Automatic (with privacy)"

   This will:
   - Keep your permanent IPv6 GUA address (2600:4040:...)
   - Generate temporary addresses for outbound connections
   - Prevent long-term IPv6 tracking
   ```

3. **Verify Changes**

   ```bash
   # Check IPv6 addresses assigned
   ifconfig | grep inet6

   # Should see multiple addresses:
   # - One permanent GUA (2600:4040:...)
   # - One ULA (fd00:...)
   # - One link-local (fe80:...)
   # - Temporary addresses (rotated periodically)
   ```

**Success Criteria**:

- ✅ IPv6 shows "Automatic (with privacy)" in Network settings
- ✅ `ifconfig` shows multiple IPv6 addresses
- ✅ Temporary IPv6 addresses rotate (check after 24 hours)

---

### Action 2.3: Disable mDNS Hostname Broadcast (FND-YCZS3WNSCZ)

**Priority**: MEDIUM  
**Effort**: 5 minutes  
**Risk Reduction**: 30% for this finding  
**Difficulty**: EASY (or skip if mDNS is needed)

**Option A: Disable Bonjour/mDNS**

```
System Preferences
→ Sharing
→ Edit the hostname or disable Bonjour services
```

**Option B: Firewall-Level Control** (Preferred if mDNS is needed)

```bash
# Block mDNS multicast (UDP 5353) at firewall level
# This requires pfctl or similar (more complex)
# OR use firewall UI to block UDP 5353 inbound
```

**Success Criteria**:

- ✅ `nslookup Trevors-MacBook-Air.local` from LAN device fails or returns no results
- OR ✅ Local services still work (if mDNS needed for them)

---

### Action 2.4: Restrict or Disable AirTunes Service (FND-XZH2RC8PH0)

**Priority**: MEDIUM  
**Effort**: 5-10 minutes  
**Risk Reduction**: 70% for this finding  
**Difficulty**: EASY

**Option A: Disable AirPlay Entirely** (if not needed)

```
System Preferences
→ Sharing
→ AirDrop
→ Select "No One"
→ Or uncheck all AirPlay options
```

**Option B: Restrict via Firewall** (if AirPlay is needed)

```
System Preferences
→ Security & Privacy
→ Firewall
→ Firewall Options
→ Click "+" to add block rule
→ Add: Block inbound TCP on ports 5000 and 7000
→ OR: Allow only from specific trusted IPs
```

**Verification**:

```bash
# Before remediation (should succeed):
curl -I http://127.0.0.1:5000/
# HTTP/1.1 403 Forbidden

# After remediation:
netstat -an | grep -E ':5000|:7000'
# Should show LISTEN but firewall blocks inbound
# OR should show no LISTEN if disabled

# Test from LAN device:
curl http://192.168.1.224:5000/
# Should timeout or get connection refused
```

**Success Criteria**:

- ✅ Port 5000 and 7000 are either closed OR filtered by firewall
- ✅ AirPlay still works locally (if enabled)
- ✅ From LAN device, connecting to 5000/7000 times out

---

### Action 2.5: Remediate Port 50776 Unknown Service (FND-0XHYD38Y0E)

**Priority**: MEDIUM  
**Effort**: 10-20 minutes (depends on Action 1.3 results)  
**Risk Reduction**: 60-80%  
**Difficulty**: MEDIUM

**Approach A: Service Is NOT Required** (Uninstall)

```bash
# If identified as development artifact or unused:
# 1. Verify safe to remove: check recent git history, no active projects
# 2. Uninstall via Homebrew (if brew package):
brew uninstall [service_name]

# 3. Or manually unload system service:
sudo launchctl unload /Library/LaunchDaemons/com.*.plist

# 4. Verify port is closed:
netstat -an | grep 50776
# Expected: No output
```

**Approach B: Service IS Required** (Restrict Access)

```bash
# 1. Configure service to bind to localhost only:
# Edit service configuration file (varies by service)
# Set: bind = 127.0.0.1 or listen = localhost
# OR set listen_on_all = false

# 2. Restart service:
sudo launchctl unload [service_plist]
sudo launchctl load [service_plist]

# 3. Verify binding changed:
netstat -an | grep 50776
# Expected: 127.0.0.1:50776 (not *.50776)

# 4. Document in asset inventory
```

**Success Criteria**:

- ✅ Port 50776 is either closed OR bound to 127.0.0.1 only
- ✅ Service still works as needed (if required)
- ✅ From LAN device, port 50776 is inaccessible

---

### Action 2.6: Create Asset Inventory Baseline (FND-R3QPNTHNKZ)

**Priority**: MEDIUM  
**Effort**: 20 minutes  
**Risk Reduction**: 20% (enables future detection)  
**Difficulty**: EASY

**Steps**:

1. **Run Baseline Scan**

   ```bash
   # Full port scan (creates baseline)
   nmap -p- -sV localhost > ~/Documents/network-baseline-2026-02-07.txt

   # Export service list
   netstat -an | grep LISTEN > ~/Documents/listening-ports-baseline-2026-02-07.txt

   # Export process list
   lsof -i > ~/Documents/network-processes-baseline-2026-02-07.txt
   ```

2. **Create Documentation**
   - Create file: `~/Documents/NETWORK_BASELINE.md`
   - List expected services and ports:

     ```markdown
     # Home Network Baseline (2026-02-07)

     ## Expected Listening Ports

     - 127.0.0.1:6379 - Redis (requires authentication after 2026-02-07)
     - 127.0.0.1:18789 - Node.js service
     - 127.0.0.1:18792 - Node.js service
     - 127.0.0.1:44438 - Zed Editor
     - 127.0.0.1:7265 - Raycast
     - 192.168.1.224:5000 - AirTunes (firewall restricted)
     - 192.168.1.224:7000 - AirTunes (firewall restricted)
     - [Description of port 50776 if kept]

     ## Any new ports should trigger investigation
     ```

3. **Schedule Quarterly Reviews**
   - Set calendar reminder for quarterly baseline comparison
   - Run: `nmap -p- -sV localhost` and compare against baseline
   - Investigate any unexpected changes

**Success Criteria**:

- ✅ Baseline files created and saved
- ✅ Expected services documented
- ✅ Quarterly review reminder set

---

## PHASE 3: ONGOING MAINTENANCE (Quarterly)

### Objective

Maintain security posture and detect unauthorized changes

**Frequency**: Monthly or Quarterly  
**Effort**: ~1 hour per month  
**Benefit**: Sustained security + early detection of unauthorized changes

---

### Activity 3.1: Monthly Port Scanning and Baseline Comparison

**Frequency**: Quarterly (every 3 months minimum)  
**Effort**: 30 minutes quarterly

```bash
# Run scan
nmap -p- -sV localhost > ~/Documents/network-scan-$(date +%Y-%m-%d).txt

# Compare to baseline
diff ~/Documents/network-baseline-2026-02-07.txt ~/Documents/network-scan-$(date +%Y-%m-%d).txt

# Investigate any differences:
# - New open ports = security investigation required
# - Closed ports = verify service was intentionally disabled
```

---

### Activity 3.2: Monthly Dependency and Vulnerability Scanning

**Frequency**: Monthly  
**Effort**: 30 minutes monthly

```bash
# For Node.js projects
npm audit
npm audit fix

# For Homebrew packages
brew update && brew upgrade

# For system security
softwareupdate -l
```

---

### Activity 3.3: Monthly Network Monitoring

**Frequency**: Monthly  
**Effort**: 15 minutes monthly

```bash
# Check router logs for suspicious access attempts
# Monitor Activity Monitor for unexpected processes
# Review System Preferences for unauthorized changes

# Create log reminder:
defaults write com.apple.LaunchServices/com.apple.sharedfilelist RecentDocuments -array-add ~/Documents/NETWORK_BASELINE.md
```

---

### Activity 3.4: Monthly System and Software Updates

**Frequency**: As released (typically monthly)  
**Effort**: 1 hour per month

```bash
# Check for macOS updates
System Preferences → Software Update

# Keep all software updated:
brew upgrade
npm update
```

---

## Success Criteria Checklist

### Phase 1 Completion

- [ ] Redis password set and persistent
- [ ] rapportd service disabled
- [ ] Port 50776 service identified

### Phase 2 Completion

- [ ] Firewall enabled and configured
- [ ] IPv6 privacy enabled
- [ ] mDNS configured or disabled
- [ ] AirTunes service restricted
- [ ] Port 50776 remediated
- [ ] Baseline documentation created

### Phase 3 Setup

- [ ] Quarterly scan reminder set
- [ ] Dependency audit schedule created
- [ ] Network monitoring process established

---

## Risk Reduction Summary

| Phase   | Effort     | Risk Reduction | Cumulative |
| ------- | ---------- | -------------- | ---------- |
| Phase 1 | 30 min     | 60%            | 60%        |
| Phase 2 | 60 min     | 30%            | 90%        |
| Phase 3 | 1 hr/month | Sustained      | 90%+       |

**Total effort for 90%+ risk reduction**: ~2 hours initial + ongoing monthly monitoring

---

## Troubleshooting

### Redis Authentication Issues

- If password doesn't work: Clear Redis data and restart
  ```bash
  redis-cli FLUSHALL  # Clear all data
  redis-cli SHUTDOWN  # Stop service
  brew services start redis  # Restart
  ```

### Firewall Blocks Required Service

- Check firewall exceptions: System Preferences → Firewall → Options
- Add exception for application if needed
- Verify service is signed (not blocked by Gatekeeper)

### Service Still Accessible After Firewall

- Verify firewall is actually enabled: `defaults read /Library/Preferences/com.apple.alf globalstate`
- Check active connections: `netstat -an | grep LISTEN`
- Verify service didn't start on different port

### IPv6 Addresses Still Public

- IPv6 privacy doesn't prevent permanent address discovery
- Consider VPN for additional privacy
- Monitor with: `ifconfig | grep inet6`

---

## Contact and Support

For questions during remediation:

1. Refer to official documentation links in the main report
2. Test changes on non-production systems first if possible
3. Document any deviations from this plan
4. Keep backup of important configuration before making changes

---

**Remediation Plan Status**: READY FOR IMPLEMENTATION  
**Last Updated**: February 7, 2026  
**Next Review**: After Phase 1 completion (within 1 week)