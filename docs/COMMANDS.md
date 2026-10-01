# melodyflix — Commands

## Termux → Ubuntu
proot-distro login ubuntu

## সব সার্ভিস চালু
~/melodyflix/scripts/start-nginx-all.sh

## Build
cd ~/melodyflix/apps/web && pnpm build
cd ~/melodyflix/apps/admin && pnpm build

## Git push
cd ~/melodyflix
git add -A
git commit -m "message"
git push

## Backup
# Termux-এ: mf-backup

## Work Rules
1. একটি ফিচার আলাদা ফাইলে
2. সমস্যা হলে শুধু সেই ফাইল rewrite
3. একটি ধাপ → আউটপুট → পরের ধাপ
4. প্রতিটি কমান্ডে মুড: 🔴 Termux / 🟢 Ubuntu
5. ~ $ = Termux, root@localhost = Ubuntu
6. বাংলায় ব্যাখ্যা, English-এ কোড
