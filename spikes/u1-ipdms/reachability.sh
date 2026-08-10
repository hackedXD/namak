#!/usr/bin/env bash
# THROWAWAY SPIKE — reachability matrix for the government source hosts (design §3.1).
# Distinguishes failure classes from a datacenter egress IP:
#   OK          = HTTP response received
#   CERT_CHAIN  = TLS ok but incomplete chain (reachable; fixable with -k / cacert)
#   RESET       = connection reset at/after TLS handshake (IP/WAF block signature)
#   TIMEOUT     = no response (drop/blackhole)
CA=/root/.ccr/ca-bundle.crt
probe () {
  local label="$1" url="$2"
  # try strict first, then -k to separate cert-chain from true block
  local out code
  out=$(curl -sS --cacert "$CA" -o /dev/null -w "%{http_code}" -L --max-time 20 "$url" 2>&1)
  code=$?
  if [ "$code" = "0" ]; then printf "%-28s OK            http=%s (strict TLS)\n" "$label" "$out"; return; fi
  # strict failed; retry insecure to classify
  local out2 code2
  out2=$(curl -sS -k -o /dev/null -w "%{http_code}" -L --max-time 20 "$url" 2>&1)
  code2=$?
  if [ "$code2" = "0" ]; then printf "%-28s CERT_CHAIN    http=%s (reachable, chain incomplete)\n" "$label" "$out2"; return; fi
  case "$out2" in
    *"reset by peer"*|*"CONNECT tunnel failed"*) printf "%-28s RESET         (%s)\n" "$label" "curl:$code2"; return;;
    *"Operation timed out"*|*"Connection timed out"*) printf "%-28s TIMEOUT\n" "$label"; return;;
  esac
  printf "%-28s FAIL          curl=%s (%s)\n" "$label" "$code2" "$(echo "$out2" | tr '\n' ' ' | cut -c1-60)"
}

echo "host                         class         detail"
echo "------------------------------------------------------------"
probe "S5 IPDMS/PharmaSahiDaam"  "https://nppaipdms.gov.in/"
probe "S3 NPPA main"             "https://nppa.gov.in/"
probe "S1/S2 Jan Aushadhi"       "https://janaushadhi.gov.in/"
probe "S1/S2 PMBI"              "https://pmbi.in/"
probe "S8 CDSCO"                 "https://cdsco.gov.in/"
probe "S3/S4 eGazette (nic)"     "https://egazette.nic.in/"
probe "S3/S4 eGazette (gov)"     "https://egazette.gov.in/"
probe "S10 data.gov.in"          "https://data.gov.in/"
probe "MoHFW"                    "https://mohfw.gov.in/"
probe "control: example.com"     "https://example.com/"
