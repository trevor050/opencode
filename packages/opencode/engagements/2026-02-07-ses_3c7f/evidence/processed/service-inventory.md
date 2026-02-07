# Service Inventory & Validation

## Target: Trevors-MacBook-Air.local (192.168.1.224)
**Date**: 2026-02-07  
**Assessment Type**: Non-destructive validation

---

## Services Discovered

### 1. **Redis Server**
- **Port**: 6379 (TCP, localhost + IPv6)
- **Version**: 8.0.0
- **Process**: `/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379`
- **Binding**: 127.0.0.1:6379, [::1]:6379
- **Status**: LISTENING
- **Validation Method**: redis-cli INFO command
- **Exposed**: NO (localhost only)

### 2. **AirTunes Service (ControlCenter)**
- **Port**: 5000, 7000 (TCP, all interfaces)
- **Version**: AirTunes/925.5.1
- **Process**: ControlCenter.app (PID 644)
- **Binding**: All interfaces (*.5000, *.7000)
- **Status**: LISTENING, HTTP 403 Forbidden
- **Validation Method**: HTTP HEAD request
- **Exposed**: YES (network accessible)

### 3. **Multiple Node.js Services**
- **Ports**: 18789, 18792, 44438, 49526, 55992, 50776
- **Binding**: Mix of localhost and wildcard
- **Process**: Various (node, zed, rapportd, ControlCenter, stable)
- **Status**: LISTENING
- **Exposed**: Partially (some listen on all interfaces)

### 4. **Network Exposure Analysis**
- **IPv4 Address**: 192.168.1.224 on en0 (active, non-static)
- **IPv6 Addresses**: Multiple GUA/ULA addresses assigned
- **Public IP**: 74.105.3.148 (ISP-assigned, geolocatable)
- **Gateway**: 192.168.1.1 (likely home router)
- **LAN Neighbors**: 4 other devices detected (192.168.1.x hosts)

---

## Service Binding Summary

| Port | Protocol | Binding | Service | Exposed |
|------|----------|---------|---------|---------|
| 5000 | TCP | *.5000 (all) | AirTunes/ControlCenter | YES |
| 6379 | TCP | 127.0.0.1 | Redis | NO |
| 7000 | TCP | *.7000 (all) | AirTunes/ControlCenter | YES |
| 18789 | TCP | ::1 (IPv6 localhost) | Node.js | NO |
| 50776 | TCP | *. (all) | Unknown | YES |
| 55992 | TCP | *.55992 (all) | rapportd | YES |

---

## Network Path Exposure

```
Internet (ISP: 74.105.3.148)
    ↓
Home Router (192.168.1.1)
    ↓
MacBook (192.168.1.224)
    ├─ Private: 127.0.0.1:6379 (Redis - isolated)
    ├─ LAN: 192.168.1.224:5000 (AirTunes - accessible to local network)
    ├─ LAN: 192.168.1.224:7000 (AirTunes - accessible to local network)
    └─ LAN: 192.168.1.224:50776 (Unknown - accessible to local network)
```

---

## Observations

1. **Redis**: Running as expected on localhost only. No direct network exposure.
2. **AirTunes**: Services responding on all interfaces (0.0.0.0, ::), accessible from LAN.
3. **Node.js Services**: Mixed binding patterns; some isolated, some potentially exposed.
4. **Network Topology**: Single point of Internet egress (home router). No direct WAN exposure detected.
5. **Binding Pattern Risk**: Listening on `*` (wildcard) instead of 127.0.0.1 exposes services to LAN.

---

## Validation Evidence

- `netstat -an` confirms all listening ports
- `lsof -i` shows process->port mapping
- `nmap -p- localhost` confirms port accessibility
- `redis-cli INFO server` validates Redis version 8.0.0
- `curl -I` confirms AirTunes headers and HTTP 403 response
- `ifconfig` shows IPv4/IPv6 bindings and network configuration
