import importlib.util
from pathlib import Path
import tempfile
import unittest
import os

spec=importlib.util.spec_from_file_location('storage_maintenance',Path(__file__).with_name('storage-maintenance.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def image(identity, repo='recruiter-backend', created='2026-01-01', tags=None):
 return {'Id':identity,'Created':created,'RepoTags':tags or ['seemplify/'+repo+':hostinger-'+identity*40]}

class SafetyContracts(unittest.TestCase):
 def test_every_container_and_three_distinct_rollback_images_are_protected(self):
  rows=[image(str(i),created='2026-01-0'+str(i)) for i in range(1,6)]
  self.assertEqual([row['Id'] for row in m.select_images(rows,{'1'})],['2'])
 def test_workspace_milo_lms_and_unknown_tags_are_never_selected(self):
  rows=[image('a',repo=repo) for repo in ['workspace','milo','lms','learning','experience']]
  rows += [image('b',tags=['seemplify/recruiter-backend:manual-recovery'])]
  self.assertEqual(m.select_images(rows,set(),keep=0),[])
 def test_aliases_cannot_consume_the_rollback_budget(self):
  latest=image('c',created='2026-01-03',tags=['seemplify/recruiter-backend:hostinger-'+('c'*40),'seemplify/recruiter-backend:latest'])
  rows=[image('a',created='2026-01-01'),image('b',created='2026-01-02'),latest]
  self.assertEqual(m.select_images(rows,set(),keep=2),[rows[0]])
 def test_image_with_any_unclassified_alias_is_protected(self):
  row=image('a',tags=['seemplify/recruiter-backend:hostinger-'+('a'*40),'other/app:backup'])
  self.assertEqual(m.select_images([row],set(),keep=0),[])

class ArchiveSafetyContracts(unittest.TestCase):
 def test_active_revisions_and_runtime_references_are_never_archived(self):
  with tempfile.TemporaryDirectory() as directory:
   previous=m.RELEASES;m.RELEASES=Path(directory)
   try:
    folder=m.RELEASES/('a'*40);(folder/'recruiter').mkdir(parents=True);os.utime(folder,(1000,1000))
    self.assertTrue(m.eligible_release(folder,set(),[],set(),200000))
    self.assertFalse(m.eligible_release(folder,{'a'*40},[],set(),200000))
    self.assertFalse(m.eligible_release(folder,set(),[str(folder/'recruiter/runtime')],set(),200000))
    self.assertFalse(m.eligible_release(folder,set(),[],{folder.name},200000))
   finally:m.RELEASES=previous
 def test_lms_and_unknown_release_layouts_are_excluded(self):
  with tempfile.TemporaryDirectory() as directory:
   previous=m.RELEASES;m.RELEASES=Path(directory)
   try:
    folder=m.RELEASES/('b'*40);folder.mkdir();os.utime(folder,(1000,1000))
    self.assertFalse(m.eligible_release(folder,set(),[],set(),200000))
    (folder/'recruiter').mkdir();(folder/'lms').mkdir();os.utime(folder,(1000,1000))
    self.assertFalse(m.eligible_release(folder,set(),[],set(),200000))
   finally:m.RELEASES=previous

if __name__=='__main__':unittest.main()
