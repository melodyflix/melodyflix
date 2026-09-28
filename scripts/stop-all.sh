#!/bin/bash
echo "🛑 Stopping melodyflix..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1
echo "✓ Stopped"
