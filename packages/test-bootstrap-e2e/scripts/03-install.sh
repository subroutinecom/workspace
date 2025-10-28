#!/bin/bash
set -e
echo "third" >> /home/workspace/order.txt
echo "Installing package..." >> /home/workspace/bootstrap.log
sudo apt-get update -qq
sudo apt-get install -y -qq htop > /dev/null 2>&1
htop --version > /home/workspace/htop-installed.txt 2>&1 || echo "htop version check failed" > /home/workspace/htop-installed.txt
echo "Script 3 executed" >> /home/workspace/bootstrap.log
