let express = require('express');
let router = express.Router();  
let DocModel = require('../Model/DocModel');

//获取新闻、公告列表
router.post('/getHomeNewsList',async(req,res,next)=>{
    try {
        let newsData =  await DocModel.getNewsList(1,1,5);
        let AnnouncementData =  await DocModel.getNewsList(2,1,5);
        res.send({code:1,msg:'',data:{news:newsData,announcement:AnnouncementData}});
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//获取新闻公告列表
router.post('/getNewsList',async(req,res,next)=>{
    try {
        //typeId 1 news 2 announcement
        let newsData =  await DocModel.getNewsList(req.body.typeId,req.body.page,req.body.pageSize);
        res.send({code:1,msg:'',data:{news:newsData}});
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//获取新闻公告详情
router.post('/getNewsModelById',async(req,res,next)=>{
    try {
        let newsModel =  await DocModel.getNewsModelById(req.body.id);
        res.send({code:1,msg:'',data:{news:newsModel}});
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//获取文章详情
router.post('/getArticleModelById',async(req,res,next)=>{
    try {
        let article =  await DocModel.getArticleModelById(req.body.id);
        res.send({code:1,msg:'',data:{article:article}});
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
module.exports = router;