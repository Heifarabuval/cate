#!/usr/bin/env python3
"""`agence preview` : aperçu HTML d'un fichier Markdown hors workspace, URL file:// imprimée."""
import io
import os
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402


class PreviewTest(unittest.TestCase):
	def test_url_file_vers_page_echappee_avec_titre(self):
		with tempfile.TemporaryDirectory() as d:
			md = os.path.join(d, 'brouillon.md')
			with open(md, 'w') as f:
				f.write('# Titre\n<script>x</script> & suite\n')
			out = io.StringIO()
			with redirect_stdout(out):
				self.assertEqual(agence.main(['preview', md, 'Mon titre']), 0)
			url = out.getvalue().strip()
			self.assertTrue(url.startswith('file://'))
			with open(urllib.parse.unquote(urllib.parse.urlparse(url).path)) as f:
				page = f.read()
			self.assertIn('<title>Mon titre</title>', page)
			self.assertIn('&lt;script&gt;x&lt;/script&gt; &amp; suite', page)
			self.assertNotIn('<script>', page)

	def test_fichier_absent_refuse(self):
		self.assertEqual(agence.main(['preview', '/nonexistent/x.md']), 1)


if __name__ == '__main__':
	unittest.main()
