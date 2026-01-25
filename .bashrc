#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
PS1='[\u@\h \W]\$ '

# Add RVM to PATH for scripting. Make sure this is the last PATH variable change.
export PATH="$PATH:$HOME/.rvm/bin"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

export PATH=/home/chris/.pgo/pgo:$PATH
export PGOUSER=/home/chris/.pgo/pgo/pgouser
export PGO_CA_CERT=/home/chris/.pgo/pgo/client.crt
export PGO_CLIENT_CERT=/home/chris/.pgo/pgo/client.crt
export PGO_CLIENT_KEY=/home/chris/.pgo/pgo/client.key
export PGOUSER="/home/chris/.pgo/pgo/pgouser"
export PGO_CA_CERT="/home/chris/.pgo/pgo/client.crt"
export PGO_CLIENT_CERT="/home/chris/.pgo/pgo/client.crt"
export PGO_CLIENT_KEY="/home/chris/.pgo/pgo/client.key"
export PGO_APISERVER_URL='https://127.0.0.1:8443'
export PGO_NAMESPACE=pgo
. "/home/chris/.deno/env"