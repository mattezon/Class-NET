const express = require('express');
const protect = require('../middleware/auth.cjs');
const { 
  createPost, 
  getAllPosts, 
  getPost, 
  updatePost, 
  deletePost,
  deleteComment,
  updateComment,
  likePost,
  getComments,
  createComment,
  reactPost,
  getUserReaction
} = require('../controllers/posts.cjs');

const router = express.Router();

router.post('/', protect, createPost);
router.get('/', getAllPosts);
router.get('/:id', getPost);
router.get('/:id/comments', getComments);
router.get('/:id/user-reaction', protect, getUserReaction);
router.post('/:id/comments', protect, createComment);
router.put('/:postId/comments/:commentId', protect, updateComment);
router.delete('/:postId/comments/:commentId', protect, deleteComment);
router.put('/:id', protect, updatePost);
router.delete('/:id', protect, deletePost);
router.post('/:id/like', protect, likePost);
router.post('/:id/react', protect, reactPost);

module.exports = router;
