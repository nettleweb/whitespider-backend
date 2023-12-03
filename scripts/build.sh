#!/bin/bash
baseDir=$(dirname $(realpath -s $0))/..

cd $baseDir
rm -rf out
set -e

if ! [ -e node_modules ]; then
	npm update -g
	npm install
fi

cd $baseDir/src/ && tsc
