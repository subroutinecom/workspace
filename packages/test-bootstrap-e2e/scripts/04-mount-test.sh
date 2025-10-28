#!/bin/bash
set -e
if [ -f /workspace/source/.workspace.yml ]; then
  echo "can-access-source" > /home/workspace/mount-test.txt
else
  echo "cannot-access-source" > /home/workspace/mount-test.txt
fi
echo "Script 4 executed" >> /home/workspace/bootstrap.log
