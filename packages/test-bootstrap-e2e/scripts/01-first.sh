#!/bin/bash
set -e
echo "first" > /home/workspace/order.txt
echo "Script 1 executed" >> /home/workspace/bootstrap.log
echo "HOME=$HOME" >> /home/workspace/env.txt
echo "USER=$USER" >> /home/workspace/env.txt
echo "PWD=$(pwd)" >> /home/workspace/env.txt
