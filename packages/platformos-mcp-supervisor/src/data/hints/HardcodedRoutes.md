  Replace hardcoded URLs with the route_url filter:
    WRONG: href="/users/{{ user.id }}"
    RIGHT: href="{{ 'users/show' | route_url: id: user.id }}"
  Route names come from the page slug: front matter field
