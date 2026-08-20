param(
  [Parameter(Mandatory = $true)][string]$Queue,
  [Parameter(Mandatory = $true)][int]$ExpectedCount,
  [switch]$Drain
)

if ($Queue -notmatch '^[a-z][a-z0-9_]*$') { throw 'Queue must be a safe PGMQ identifier' }
if ($ExpectedCount -lt 0) { throw 'ExpectedCount must be non-negative' }
$table = "pgmq.q_$Queue"
$summary = docker exec admin psql -U postgres -d ndx_business -Atc "SELECT count(*)::text || ',' || count(DISTINCT message->>'transactionKey')::text FROM $table"
$parts = $summary.Trim().Split(','); $count = [int]$parts[0]; $transactions = [int]$parts[1]
if ($count -ne $ExpectedCount -or $transactions -ne $ExpectedCount) { throw "queue=$Queue expected=$ExpectedCount actual=$count distinctTransactions=$transactions" }
if ($Drain) {
  docker exec admin psql -U postgres -d ndx_business -Atc "SELECT pgmq.delete('$Queue', msg_id) FROM $table" | Out-Null
  $remaining = (docker exec admin psql -U postgres -d ndx_business -Atc "SELECT count(*) FROM $table").Trim()
  if ($remaining -ne '0') { throw "queue=$Queue was not drained: $remaining remaining" }
}
[pscustomobject]@{ queue = $Queue; messages = $count; distinctTransactions = $transactions; drained = [bool]$Drain } | ConvertTo-Json -Compress
