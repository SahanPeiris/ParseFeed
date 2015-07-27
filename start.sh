#!/bin/bash
export PORT=9000;
forever -c node bin/www >> msg.log 2>> err.log &
