const express = require('express');
const protect = require('../middleware/auth.cjs');
const {
  createProject,
  getProjects,
  participateProject,
  cancelParticipation,
  removeParticipant,
  completeProject,
  deleteProject
} = require('../controllers/projects.cjs');

const router = express.Router();

// Public routes
router.get('/', getProjects);

// Private routes
router.post('/', protect, createProject);
router.post('/:id/participate', protect, participateProject);
router.post('/:id/leave', protect, cancelParticipation);
router.post('/:id/complete', protect, completeProject);
router.delete('/:id/participants/:userId', protect, removeParticipant);
router.delete('/:id', protect, deleteProject);

module.exports = router;