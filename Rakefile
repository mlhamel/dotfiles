task default: %w[homebrew:install]

namespace :homebrew do
  task :install do
    system 'bundle install && brew bundle --file=homebrew/Brewfile'
  end
  task :update do
    system 'brew bundle dump --file=homebrew/Brewfile --force'
  end
end
