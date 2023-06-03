#!/bin/bash
cd $(dirname $0)
nohup node . > /dev/null &
disown
