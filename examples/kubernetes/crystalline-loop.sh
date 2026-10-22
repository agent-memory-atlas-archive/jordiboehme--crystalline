#!/bin/sh
# crystalline-loop <reflect|evolve> [run flags...]
#
# Runs `crystalline <loop> run` once for a scheduler that reads every exit
# code that is not 0 as a failure (a Kubernetes CronJob, a GitHub Actions
# job). `run` exits 1 when nothing is due or a run already holds the lease.
# That is the normal case, so it ends here with 0. A failed run or an error
# keeps its exit code 2.
#
# The run gets SIGTERM from this shell, so a stopped pod still records its
# run and releases the lease (it needs about 25 seconds).
set -u

loop="${1:?usage: crystalline-loop <reflect|evolve> [run flags...]}"
shift

crystalline "$loop" run "$@" &
pid=$!
stopped=0
trap 'stopped=1; kill -TERM "$pid" 2>/dev/null' TERM INT
wait "$pid"
code=$?
# A signal ends the first wait early. Wait for the run itself to end.
if [ "$stopped" -eq 1 ]; then
  wait "$pid"
  code=$?
fi
if [ "$code" -eq 1 ]; then
  exit 0
fi
exit "$code"
